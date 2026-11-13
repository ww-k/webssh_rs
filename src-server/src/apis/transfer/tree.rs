use std::collections::HashMap;

use crate::{
    apis::ApiErr,
    entities::transfer_task::{Model as TransferTaskModel, TransferTaskKind, TransferTaskStatus},
};

use super::{
    dto::{TransferTreeNode, TransferTreeNodeType},
    handlers::IntoTransferResponse,
};

#[derive(Default, Clone)]
struct Aggregate {
    has_status: bool,
    has_run: bool,
    has_wait: bool,
    has_pause: bool,
    has_fail: bool,
    has_cancel: bool,
    has_success: bool,
    loaded: i64,
    total: i64,
    speed: i64,
    fail_reason: Option<String>,
    estimated_time: Option<i64>,
    ended_at: Option<i64>,
    node_count: usize,
    ended_count: usize,
    file_count: usize,
    completed_count: usize,
    failed_count: usize,
    directory_count: usize,
    directory_failed_count: usize,
}

impl Aggregate {
    fn from_node(node: &TransferTreeNode) -> Self {
        let mut aggregate = Self::default();
        aggregate.record_status(&node.status);
        aggregate.node_count = 1;
        aggregate.ended_count = usize::from(node.ended_at.is_some());
        aggregate.ended_at = node.ended_at;
        aggregate.estimated_time = node.estimated_time;
        aggregate.fail_reason = node.fail_reason.clone();
        match node.node_type {
            TransferTreeNodeType::File => {
                aggregate.loaded = node.loaded;
                aggregate.total = node.total;
                aggregate.speed = node.speed;
                aggregate.file_count = 1;
                aggregate.completed_count = usize::from(node.status == TransferTaskStatus::Success);
                aggregate.failed_count = usize::from(node.status == TransferTaskStatus::Fail);
            }
            TransferTreeNodeType::Directory => {
                aggregate.directory_count = 1;
                aggregate.directory_failed_count =
                    usize::from(node.status == TransferTaskStatus::Fail);
            }
            TransferTreeNodeType::Batch => {}
        }
        aggregate
    }

    fn record_status(&mut self, status: &TransferTaskStatus) {
        self.has_status = true;
        match status {
            TransferTaskStatus::Run => self.has_run = true,
            TransferTaskStatus::Wait => self.has_wait = true,
            TransferTaskStatus::Pause => self.has_pause = true,
            TransferTaskStatus::Fail => self.has_fail = true,
            TransferTaskStatus::Cancel => self.has_cancel = true,
            TransferTaskStatus::Success => self.has_success = true,
        }
    }

    fn merge(&mut self, other: &Self) {
        self.has_status |= other.has_status;
        self.has_run |= other.has_run;
        self.has_wait |= other.has_wait;
        self.has_pause |= other.has_pause;
        self.has_fail |= other.has_fail;
        self.has_cancel |= other.has_cancel;
        self.has_success |= other.has_success;
        self.loaded += other.loaded;
        self.total += other.total;
        self.speed += other.speed;
        self.node_count += other.node_count;
        self.ended_count += other.ended_count;
        self.file_count += other.file_count;
        self.completed_count += other.completed_count;
        self.failed_count += other.failed_count;
        self.directory_count += other.directory_count;
        self.directory_failed_count += other.directory_failed_count;
        if self.fail_reason.is_none() {
            self.fail_reason = other.fail_reason.clone();
        }
        self.estimated_time = self.estimated_time.max(other.estimated_time);
        self.ended_at = self.ended_at.max(other.ended_at);
    }
}

pub fn build_transfer_tree(tasks: Vec<TransferTaskModel>) -> Result<Vec<TransferTreeNode>, ApiErr> {
    let mut standalone = Vec::new();
    let mut batches: HashMap<String, Vec<TransferTaskModel>> = HashMap::new();
    for task in tasks {
        if let Some(batch_id) = task.batch_id.clone() {
            batches.entry(batch_id).or_default().push(task);
        } else {
            standalone.push(task_node(task)?);
        }
    }

    let mut result = standalone;
    for (batch_id, tasks) in batches {
        result.push(build_batch_node(batch_id, tasks)?);
    }
    sort_nodes(&mut result);
    Ok(result)
}

fn build_batch_node(
    batch_id: String,
    tasks: Vec<TransferTaskModel>,
) -> Result<TransferTreeNode, ApiErr> {
    let first = tasks.first().ok_or_else(|| ApiErr {
        code: crate::consts::services_err_code::ERR_CODE_TRANSFER_INVALID_REQUEST,
        message: "empty transfer batch".to_string(),
    })?;
    let mut nodes = HashMap::new();
    let mut children_by_parent: HashMap<String, Vec<String>> = HashMap::new();
    let mut roots = Vec::new();
    for task in &tasks {
        let id = task.id.clone();
        if let Some(parent_id) = task.parent_id.clone() {
            children_by_parent
                .entry(parent_id)
                .or_default()
                .push(id.clone());
        } else {
            roots.push(id.clone());
        }
        nodes.insert(id, task_node(task.clone())?);
    }

    // A corrupt or partially migrated parent reference must not hide a task.
    for task in &tasks {
        if task
            .parent_id
            .as_ref()
            .is_some_and(|parent| !nodes.contains_key(parent))
        {
            if !roots.contains(&task.id) {
                roots.push(task.id.clone());
            }
        }
    }

    let mut child_results = roots
        .into_iter()
        .filter_map(|id| take_node(&id, &mut nodes, &mut children_by_parent))
        .collect::<Vec<_>>();
    let mut aggregate = Aggregate::default();
    let mut children = Vec::with_capacity(child_results.len());
    for (child, child_aggregate) in child_results.drain(..) {
        aggregate.merge(&child_aggregate);
        children.push(child);
    }
    sort_nodes(&mut children);
    if children.len() == 1 {
        return Ok(children.remove(0));
    }
    let names = children
        .iter()
        .map(|node| node.name.as_str())
        .collect::<Vec<_>>();
    let name = if names.len() == 1 {
        names[0].to_string()
    } else {
        format!(
            "{} 等 {} 个",
            names.first().copied().unwrap_or("Transfer"),
            names.len()
        )
    };
    let all_ended = aggregate.node_count > 0 && aggregate.node_count == aggregate.ended_count;
    Ok(TransferTreeNode {
        id: batch_id.clone(),
        node_type: TransferTreeNodeType::Batch,
        r#type: first.r#type.clone(),
        kind: None,
        status: aggregate_status(&aggregate),
        local_path: None,
        target_uri: None,
        target_id: first.target_id,
        name,
        loaded: aggregate.loaded,
        total: aggregate.total,
        percent: percentage(&aggregate),
        speed: aggregate.speed,
        estimated_time: aggregate.estimated_time,
        ranges: Vec::new(),
        fail_reason: aggregate.fail_reason,
        created_at: tasks.iter().map(|task| task.created_at).min().unwrap_or(0),
        updated_at: tasks.iter().map(|task| task.updated_at).max().unwrap_or(0),
        ended_at: all_ended.then(|| aggregate.ended_at.unwrap_or(0)),
        batch_id: Some(batch_id),
        parent_id: None,
        relative_path: None,
        conflict_policy: first.conflict_policy,
        all: false,
        item_count: Some(aggregate.file_count),
        completed_count: Some(aggregate.completed_count),
        failed_count: Some(aggregate.failed_count),
        directory_count: Some(aggregate.directory_count),
        directory_failed_count: Some(aggregate.directory_failed_count),
        children,
    })
}

fn task_node(task: TransferTaskModel) -> Result<TransferTreeNode, ApiErr> {
    let response = task.clone().into_response()?;
    let node_type = match task.kind {
        TransferTaskKind::Directory => TransferTreeNodeType::Directory,
        TransferTaskKind::File => TransferTreeNodeType::File,
    };
    Ok(TransferTreeNode {
        id: response.id,
        node_type,
        r#type: response.r#type,
        kind: Some(response.kind),
        status: response.status,
        local_path: response.local_path,
        target_uri: response.target_uri,
        target_id: response.target_id,
        name: response.name,
        loaded: response.loaded,
        total: response.total,
        percent: response.percent,
        speed: response.speed,
        estimated_time: response.estimated_time,
        ranges: response.ranges,
        fail_reason: response.fail_reason,
        created_at: response.created_at,
        updated_at: response.updated_at,
        ended_at: response.ended_at,
        batch_id: response.batch_id,
        parent_id: response.parent_id,
        relative_path: response.relative_path,
        conflict_policy: response.conflict_policy,
        all: response.all,
        item_count: None,
        completed_count: None,
        failed_count: None,
        directory_count: None,
        directory_failed_count: None,
        children: Vec::new(),
    })
}

fn take_node(
    id: &str,
    nodes: &mut HashMap<String, TransferTreeNode>,
    children_by_parent: &mut HashMap<String, Vec<String>>,
) -> Option<(TransferTreeNode, Aggregate)> {
    let mut node = nodes.remove(id)?;
    let child_ids = children_by_parent.remove(id).unwrap_or_default();
    let mut child_results = child_ids
        .into_iter()
        .filter_map(|child_id| take_node(&child_id, nodes, children_by_parent))
        .collect::<Vec<_>>();
    let own_aggregate = Aggregate::from_node(&node);
    let mut aggregate = own_aggregate.clone();
    let mut children = Vec::with_capacity(child_results.len());
    for (child, child_aggregate) in child_results.drain(..) {
        aggregate.merge(&child_aggregate);
        children.push(child);
    }
    sort_nodes(&mut children);
    node.children = children;
    if node.node_type == TransferTreeNodeType::Directory && !node.children.is_empty() {
        node.status = aggregate_status(&aggregate);
        node.loaded = aggregate.loaded;
        node.total = aggregate.total;
        node.percent = percentage(&aggregate);
        node.speed = aggregate.speed;
        node.estimated_time = aggregate.estimated_time;
        node.fail_reason = aggregate.fail_reason.clone();
        node.ended_at = (aggregate.node_count == aggregate.ended_count)
            .then_some(aggregate.ended_at)
            .flatten();
    }
    Some((node, aggregate))
}

fn aggregate_status(aggregate: &Aggregate) -> TransferTaskStatus {
    if aggregate.has_run {
        TransferTaskStatus::Run
    } else if aggregate.has_wait {
        TransferTaskStatus::Wait
    } else if aggregate.has_pause {
        TransferTaskStatus::Pause
    } else if aggregate.has_fail {
        TransferTaskStatus::Fail
    } else if aggregate.has_cancel {
        TransferTaskStatus::Cancel
    } else {
        TransferTaskStatus::Success
    }
}

fn percentage(aggregate: &Aggregate) -> f64 {
    if aggregate.total > 0 {
        return (aggregate.loaded as f64 / aggregate.total as f64) * 100.0;
    }
    if aggregate.has_status && !aggregate.has_run && !aggregate.has_wait && !aggregate.has_pause {
        100.0
    } else {
        0.0
    }
}

fn sort_nodes(nodes: &mut [TransferTreeNode]) {
    nodes.sort_by(|left, right| {
        status_order(&left.status)
            .cmp(&status_order(&right.status))
            .then_with(|| right.created_at.cmp(&left.created_at))
            .then_with(|| right.id.cmp(&left.id))
    });
}

fn status_order(status: &TransferTaskStatus) -> u8 {
    match status {
        TransferTaskStatus::Fail => 0,
        TransferTaskStatus::Run => 1,
        TransferTaskStatus::Wait => 2,
        TransferTaskStatus::Pause => 3,
        TransferTaskStatus::Success | TransferTaskStatus::Cancel => 4,
    }
}
