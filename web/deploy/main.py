import uspd_web_update
from Common import web_files
import sys

# Параметры подключения к УСПД по SSH
ssh_ip = "82.146.44.140"
ssh_user = "root"
ssh_password = "ghbdtnjvktn"

if __name__ == '__main__':
    uspd_web_update.uspd_web_update(False, ssh_ip, ssh_user, ssh_password)
