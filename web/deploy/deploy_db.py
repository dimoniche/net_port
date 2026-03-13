#!/usr/bin/env python3
"""
Скрипт для развертывания базы данных с необходимыми таблицами и полями.
"""

import psycopg2
from psycopg2 import sql
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT


def create_database(dbname, user, password, host='localhost', port='5432'):
    """
    Создает базу данных, если она не существует.
    """
    try:
        # Подключаемся к серверу PostgreSQL без указания базы данных
        conn = psycopg2.connect(
            dbname='postgres',
            user=user,
            password=password,
            host=host,
            port=port
        )
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cursor = conn.cursor()
        
        # Проверяем существование базы данных
        cursor.execute(sql.SQL("SELECT 1 FROM pg_database WHERE datname = %s"), [dbname])
        exists = cursor.fetchone() is not None
        
        if not exists:
            print(f"Создание базы данных '{dbname}'...")
            cursor.execute(sql.SQL("CREATE DATABASE {};").format(sql.Identifier(dbname)))
            print(f"База данных '{dbname}' успешно создана.")
        else:
            print(f"База данных '{dbname}' уже существует.")
        
        cursor.close()
        conn.close()
        
        return True
    except Exception as e:
        print(f"Ошибка при создании базы данных: {e}")
        return False


def create_tables(dbname, user, password, host='localhost', port='5432'):
    """
    Создает необходимые таблицы в базе данных.
    """
    try:
        conn = psycopg2.connect(
            dbname=dbname,
            user=user,
            password=password,
            host=host,
            port=port
        )
        cursor = conn.cursor()
        
        # Создаем таблицу servers
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS servers (
                user_id INTEGER,
                input_port INTEGER,
                output_port INTEGER,
                enable BOOLEAN,
                enable_ssl BOOLEAN
            );
        """)
        print("Таблица 'servers' успешно создана или уже существует.")
        
        # Создаем таблицу users
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                login VARCHAR(255) NOT NULL,
                password VARCHAR(255) NOT NULL,
                email VARCHAR(255),
                role VARCHAR(50)
            );
        """)
        print("Таблица 'users' успешно создана или уже существует.")
        
        # Добавляем администратора по умолчанию, если его нет
        cursor.execute("SELECT 1 FROM users WHERE login = 'admin'")
        admin_exists = cursor.fetchone() is not None
        
        if not admin_exists:
            cursor.execute("""
                INSERT INTO users (login, password, role)
                VALUES ('admin', 'admin', 'admin');
            """)
            print("Администратор по умолчанию успешно добавлен.")
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return True
    except Exception as e:
        print(f"Ошибка при создании таблиц: {e}")
        return False


def main(dbname, user, password, host='localhost', port='5432'):
    print(f"Развертывание базы данных '{dbname}'...")
    
    # Создаем базу данных
    if not create_database(dbname, user, password, host, port):
        print("Не удалось создать базу данных.")
        return False
    
    # Создаем таблицы
    if not create_tables(dbname, user, password, host, port):
        print("Не удалось создать таблицы.")
        return False
    
    print("Развертывание базы данных успешно завершено.")
    return True


if __name__ == '__main__':
    import sys
    
    # Получаем параметры из командной строки
    dbname = sys.argv[1]
    user = sys.argv[2]
    password = sys.argv[3]
    host = sys.argv[4]
    port = sys.argv[5]
    
    main(dbname, user, password, host, port)