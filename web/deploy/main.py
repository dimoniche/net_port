import uspd_web_update
from Common import web_files
import sys

if __name__ == '__main__':
    # Получаем параметры из командной строки
    ssh_ip = sys.argv[1]
    ssh_user = sys.argv[2]
    ssh_password = sys.argv[3]
    
    # Параметры подключения к базе данных
    db_name = sys.argv[4]
    db_user = sys.argv[5]
    db_password = sys.argv[6]
    db_host = sys.argv[7]
    db_port = sys.argv[8]
    
    uspd_web_update.uspd_web_update(False, ssh_ip, ssh_user, ssh_password, db_name, db_user, db_password, db_host, db_port)
