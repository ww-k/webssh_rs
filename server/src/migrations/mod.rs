pub use sea_orm_migration::prelude::*;

mod m000001_init_db;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![Box::new(m000001_init_db::Migration)]
    }
}

#[cfg(test)] // 只在测试时编译
mod tests {
    use crate::{Migrator, MigratorTrait};
    use sea_orm::{Database, FromQueryResult, Statement};

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

            let selector = TableName::find_by_statement(Statement::from_string(
                db.get_database_backend(),
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
                    .to_owned(),
            ));
            let rows = selector.all(&db).await.unwrap();

            assert_eq!(rows.len(), 2);
            assert_eq!(
                Vec::from_iter(rows.iter().map(|row| row.name.as_str())),
                vec!["seaql_migrations", "target"]
            );
        });
    }
}
