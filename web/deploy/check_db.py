#!/usr/bin/env python3
"""
Скрипт для проверки существования базы данных и необходимых таблиц.
"""

import psycopg2
from psycopg2 import sql
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT


def check_database_exists(dbname, user, password, host='localhost', port='5432'):
    """
    Проверяет, существует ли база данных.
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
        
        cursor.close()
        conn.close()
        
        return exists
    except Exception as e:
        print(f"Ошибка при проверке существования базы данных: {e}")
        return False


def check_tables_exist(dbname, user, password, host='localhost', port='5432'):
    """
    Проверяет, существуют ли необходимые таблицы в базе данных.
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
        
        # Проверяем существование таблицы servers
        cursor.execute("""
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_name = 'servers'
            )
        """)
        servers_exists = cursor.fetchone()[0]
        
        # Проверяем существование таблицы users
        cursor.execute("""
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_name = 'users'
            )
        """)
        users_exists = cursor.fetchone()[0]
        
        cursor.close()
        conn.close()
        
        return servers_exists, users_exists
    except Exception as e:
        print(f"Ошибка при проверке существования таблиц: {e}")
        return False, False


def main(dbname, user, password, host='localhost', port='5432'):
    print(f"Проверка существования базы данных '{dbname}'...")
    db_exists = check_database_exists(dbname, user, password, host, port)
    
    if db_exists:
        print(f"База данных '{dbname}' существует.")
        print("Проверка существования таблиц...")
        servers_exists, users_exists = check_tables_exist(dbname, user, password, host, port)
        
        if servers_exists:
            print("Таблица 'servers' существует.")
        else:
            print("Таблица 'servers' не существует.")
        
        if users_exists:
            print("Таблица 'users' существует.")
        else:
            print("Таблица 'users' не существует.")
    else:
        print(f"База данных '{dbname}' не существует.")
    
    return db_exists, servers_exists, users_exists


if __name__ == '__main__':
    import sys
    
    # Получаем параметры из командной строки
    dbname = sys.argv[1]
    user = sys.argv[2]
    password = sys.argv[3]
    host = sys.argv[4]
    port = sys.argv[5]
    
    main(dbname, user, password, host, port)