pub use sea_orm_migration::prelude::*;

mod m000001_init_db;
mod m000002_target_jump_host;
mod m000003_preferences;
mod m000004_target_name;
mod m000005_ssh_known_host_endpoint;
mod m000006_transfer_batches;
mod m000007_target_directory;
mod m000008_target_sort_order;
mod m000009_preference_tabs;
mod m000010_transfer_task_parent;
mod m000011_port_forward;
mod m000012_tab_active_child;
mod m000013_port_forward_name;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m000001_init_db::Migration),
            Box::new(m000002_target_jump_host::Migration),
            Box::new(m000003_preferences::Migration),
            Box::new(m000004_target_name::Migration),
            Box::new(m000005_ssh_known_host_endpoint::Migration),
            Box::new(m000006_transfer_batches::Migration),
            Box::new(m000007_target_directory::Migration),
            Box::new(m000008_target_sort_order::Migration),
            Box::new(m000009_preference_tabs::Migration),
            Box::new(m000010_transfer_task_parent::Migration),
            Box::new(m000011_port_forward::Migration),
            Box::new(m000012_tab_active_child::Migration),
            Box::new(m000013_port_forward_name::Migration),
        ]
    }
}

#[cfg(test)] // 只在测试时编译
mod tests {
    use std::fmt::Debug;

    use crate::Migrator;
    use crate::{
        entities::{port_forward, target},
        migrations::MigratorTrait,
    };
    use sea_orm::{
        ActiveModelTrait, ActiveValue::Set, Database, EntityTrait, FromQueryResult, Statement,
    };

    use super::*; // 导入外部项

    #[derive(Debug, FromQueryResult)]
    struct TableName {
        name: String,
    }

    #[test]
    fn test_migrations() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let db = Database::connect("sqlite::memory:")
                .await
                .expect("Database connection failed");

            Migrator::up(&db, None).await.unwrap();

            let stmt = Statement::from_string(
                db.get_database_backend(),
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
                    .to_owned(),
            );
            let stmt2 = stmt.clone();
            let rows = TableName::find_by_statement(stmt).all(&db).await.unwrap();

            assert_eq!(rows.len(), 8, "Expected 8 tables, got {}", rows.len());
            assert_eq!(
                Vec::from_iter(rows.iter().map(|row| row.name.as_str())),
                vec![
                    "seaql_migrations",
                    "target",
                    "ssh_known_host",
                    "transfer_task",
                    "favorite_directory",
                    "tabs",
                    "app_state",
                    "port_forward"
                ],
                "Unexpected tables: {:?}",
                rows
            );

            let columns = db
                .query_all(Statement::from_string(
                    db.get_database_backend(),
                    "PRAGMA table_info(port_forward)".to_owned(),
                ))
                .await
                .unwrap();
            assert!(columns.iter().any(|row| {
                row.try_get::<String>("", "name")
                    .is_ok_and(|name| name == "name")
            }));

            let active_model = target::ActiveModel::from(target::Model {
                id: 1,
                sort_order: 0,
                color: None,
                name: "Test target".to_string(),
                directory: String::new(),
                host: "127.0.0.1".to_string(),
                port: None,
                method: target::TargetAuthMethod::Password,
                user: "root".to_string(),
                key: None,
                password: Some("123456".to_string()),
                system: Some("windows".to_string()),
                jump_host_id: None,
            });
            let target1 = active_model.insert(&db).await.unwrap();
            assert_eq!(
                Some("windows".to_string()),
                target1.system,
                "Expected system: windows, got: {:?}",
                target1
            );

            port_forward::ActiveModel {
                id: Set("forward-1".to_string()),
                name: Set("Web service".to_string()),
                target_id: Set(target1.id),
                local_host: Set("127.0.0.1".to_string()),
                local_port: Set(19090),
                remote_host: Set("127.0.0.1".to_string()),
                remote_port: Set(9090),
                enabled: Set(false),
            }
            .insert(&db)
            .await
            .unwrap();
            let forward = port_forward::Entity::find_by_id("forward-1")
                .one(&db)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(forward.name, "Web service");
            let mut forward_update = port_forward::ActiveModel::from(forward);
            forward_update.name = Set("Updated service".to_string());
            forward_update.update(&db).await.unwrap();
            let forward = port_forward::Entity::find_by_id("forward-1")
                .one(&db)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(forward.name, "Updated service");

            Migrator::down(&db, None).await.unwrap();
            let rows = TableName::find_by_statement(stmt2).all(&db).await.unwrap();
            assert_eq!(rows.len(), 1);
            assert_eq!(
                Vec::from_iter(rows.iter().map(|row| row.name.as_str())),
                vec!["seaql_migrations"]
            );
        });
    }
}
