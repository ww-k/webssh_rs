use sea_orm::{
    ColIdx, TryGetable,
    entity::prelude::*,
    sea_query::{ArrayType, ValueType, ValueTypeErr},
};
use serde::{Deserialize, Serialize};
use serde_repr::{Deserialize_repr, Serialize_repr};
use utoipa::ToSchema;

#[derive(Deserialize_repr, Serialize_repr, Clone, Debug, PartialEq, Eq, ToSchema)]
#[repr(i32)]
pub enum TargetAuthMethod {
    #[serde(rename = "password")]
    Password = 1,
    #[serde(rename = "private_key")]
    PrivateKey = 2,
    #[serde(rename = "none")]
    None = 3,
    // HostBased,
    // HostBased,
    // KeyboardInteractive,
}

impl TryFrom<i32> for TargetAuthMethod {
    type Error = String;

    fn try_from(value: i32) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(TargetAuthMethod::Password),
            2 => Ok(TargetAuthMethod::PrivateKey),
            3 => Ok(TargetAuthMethod::None),
            _ => Err(format!("invalid target auth method value {}", value)),
        }
    }
}

// 为 SeaORM 实现 Value::from()
impl From<TargetAuthMethod> for Value {
    fn from(method: TargetAuthMethod) -> Self {
        Value::Int(Some(method as i32))
    }
}

// 为 SeaORM 实现 ValueType（用于数据库 schema）
impl ValueType for TargetAuthMethod {
    fn try_from(v: Value) -> Result<Self, ValueTypeErr> {
        if let Value::Int(Some(v)) = v {
            <TargetAuthMethod as TryFrom<i32>>::try_from(v).map_err(|_| ValueTypeErr)
        } else {
            Err(ValueTypeErr)
        }
    }

    fn type_name() -> String {
        "TargetAuthMethod".to_string()
    }

    fn column_type() -> ColumnType {
        ColumnType::Integer
    }

    fn array_type() -> ArrayType {
        ArrayType::Int
    }
}

// 必须实现 TryGetable，以便从查询结果中提取值
impl TryGetable for TargetAuthMethod {
    fn try_get_by<I: ColIdx>(res: &QueryResult, index: I) -> Result<Self, TryGetError> {
        let value: i32 = res.try_get_by(index)?;
        <TargetAuthMethod as TryFrom<i32>>::try_from(value)
            .map_err(|err| TryGetError::DbErr(DbErr::Custom(err)))
    }
}

#[derive(Deserialize, Serialize, Clone, PartialEq, Eq, DeriveEntityModel, ToSchema)]
#[sea_orm(table_name = "target")]
#[schema(as = Target)]
pub struct Model {
    #[sea_orm(primary_key)]
    #[serde(skip_deserializing)]
    pub id: i32,
    /// SSH 目标主机地址
    pub host: String,
    /// SSH 端口号，默认为 22
    pub port: Option<u16>,
    /// 认证方式：密码、私钥或无认证
    #[sea_orm(from = "i32")]
    pub method: TargetAuthMethod,
    /// SSH 用户名
    pub user: String,
    /// 私钥内容（当 method 为 private_key 时使用）
    pub key: Option<String>,
    /// 密码（当 method 为 password 时使用）
    pub password: Option<String>,
    /// 操作系统类型（如 windows、linux 等）
    pub system: Option<String>,
}

impl std::fmt::Debug for Model {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Model")
            .field("id", &self.id)
            .field("host", &self.host)
            .field("port", &self.port)
            .field("method", &self.method)
            .field("user", &self.user)
            .field("key", &"<secret>")
            .field("password", &"<secret>")
            .field("system", &self.system)
            .finish()
    }
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
