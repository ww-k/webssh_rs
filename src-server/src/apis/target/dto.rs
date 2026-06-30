use sea_orm::ActiveValue::Set;
use serde::Deserialize;

use crate::entities::target::{self, TargetAuthMethod};

#[derive(Deserialize, Debug, utoipa::ToSchema)]
pub struct TargetUpdatePayload {
    /// 目标 ID
    pub id: i32,
    /// SSH 目标主机地址
    pub host: String,
    /// SSH 端口号
    pub port: Option<u16>,
    /// 认证方式
    pub method: TargetAuthMethod,
    /// SSH 用户名
    pub user: String,
    /// 私钥内容
    pub key: Option<String>,
    /// 密码
    pub password: Option<String>,
    /// 操作系统类型
    pub system: Option<String>,
}

impl From<TargetUpdatePayload> for target::ActiveModel {
    fn from(p: TargetUpdatePayload) -> Self {
        target::ActiveModel {
            id: Set(p.id),
            host: Set(p.host),
            port: Set(p.port),
            method: Set(p.method),
            user: Set(p.user),
            key: Set(p.key),
            password: Set(p.password),
            system: Set(p.system),
        }
    }
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct TargetRemovePayload {
    /// 要删除的目标 ID
    pub id: i32,
}
