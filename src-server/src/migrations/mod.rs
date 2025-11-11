pub use sea_orm_migration::prelude::*;

mod m000001_init_db;
mod m000002_win_target;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m000001_init_db::Migration),
            Box::new(m000002_win_target::Migration),
        ]
    }
}

#[cfg(test)] // 只在测试时编译
mod tests {
    use std::fmt::Debug;

    use crate::entities::target::{self};
    use crate::{Migrator, MigratorTrait};
    use sea_orm::{ActiveModelTrait, Database, FromQueryResult, Statement};

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

            Migrator::up(&db, Some(1)).await.unwrap();

            let stmt = Statement::from_string(
                db.get_database_backend(),
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
                    .to_owned(),
            );
            let stmt2 = stmt.clone();
            let rows = TableName::find_by_statement(stmt).all(&db).await.unwrap();

            assert_eq!(rows.len(), 2, "Expecte 2 tables, got {}", rows.len());
            assert_eq!(
                Vec::from_iter(rows.iter().map(|row| row.name.as_str())),
                vec!["seaql_migrations", "target"],
                "Expected tables: seaql_migrations, target, got: {:?}",
                rows
            );

            let active_model = target::ActiveModel::from(target::Model {
                id: 1,
                host: "127.0.0.1".to_string(),
                port: None,
                method: target::TargetAuthMethod::Password,
                user: "root".to_string(),
                key: None,
                password: Some("123456".to_string()),
                system: Some("windows".to_string()),
            });
            let active_model2 = active_model.clone();
            let active_model3 = active_model.clone();
            let result = active_model.insert(&db).await;
            assert!(result.is_err(), "Expecte Insert failed");

            Migrator::up(&db, Some(1)).await.unwrap();
            let target1 = active_model2.insert(&db).await.unwrap();
            assert_eq!(
                Some("windows".to_string()),
                target1.system,
                "Expected system: windows, got: {:?}",
                target1
            );

            Migrator::down(&db, Some(1)).await.unwrap();
            let result = active_model3.insert(&db).await;
            assert!(result.is_err(), "Expecte Insert failed");

            Migrator::down(&db, Some(1)).await.unwrap();
            let rows = TableName::find_by_statement(stmt2).all(&db).await.unwrap();
            assert_eq!(rows.len(), 1);
            assert_eq!(
                Vec::from_iter(rows.iter().map(|row| row.name.as_str())),
                vec!["seaql_migrations"]
            );
        });
    }
}
