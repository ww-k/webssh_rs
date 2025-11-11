use sea_orm::{
    ColIdx, TryGetable,
    entity::prelude::*,
    sea_query::{ArrayType, ValueType, ValueTypeErr},
};
use serde::{Deserialize, Serialize};
use serde_repr::{Deserialize_repr, Serialize_repr};

#[derive(Deserialize_repr, Serialize_repr, Clone, Debug, PartialEq, Eq)]
#[repr(i32)]
pub enum TargetAuthMethod {
    Password = 1,
    PrivateKey = 2,
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

#[derive(Deserialize, Serialize, Clone, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "target")]
pub struct Model {
    #[sea_orm(primary_key)]
    #[serde(skip_deserializing)]
    pub id: i32,
    pub host: String,
    pub port: Option<u16>,
    #[sea_orm(from = "i32")]
    pub method: TargetAuthMethod,
    pub user: String,
    pub key: Option<String>,
    pub password: Option<String>,
    /// windows and other
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
