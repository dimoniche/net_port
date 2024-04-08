from Common import web_files

import subprocess
import os
import shutil

def uspd_web_update(build, ssh_ip, ssh_user, ssh_password):

    # создаем архив с backend
    inFolder = "backend_net_port"
    outFolder = "result"

    if not os.path.isdir(outFolder):
        os.makedirs(outFolder)

    if not os.path.isdir(inFolder + '\\node_modules'):
        print('Update depends backends: npm install')
        subprocess.check_call('npm install', shell=True, cwd=inFolder)

    print("Create tar with backend in folder: " + outFolder)
    web_files.make_tarfile(outFolder + "\\backend.tgz", inFolder)
    print("success\n")

    # создаем сборку frontend
    inFolder =  "frontend_net_port"
    print("Create client: " + inFolder)

    if not os.path.isdir(inFolder + '\\node_modules'):
        print('Update depends: npm install')
        subprocess.check_call('npm install', shell=True, cwd=inFolder)

    print("Frontend optimization")
    subprocess.check_call('npx browserslist@latest --update-db', shell=True, cwd=inFolder)

    print('Start build frontend: npm run build')
    subprocess.check_call('npm run build', shell=True, cwd=inFolder)
    print("success\n")

    # создаем архив с frontend
    inFolder = "frontend_net_port\\build"

    print("Create tar with backend in folder: " + outFolder)
    web_files.make_tarfile(outFolder + "\\frontend.tgz", inFolder)
    print("success\n")

    if not build:
        # шлем файлы на указанный УСПД
        print("Copy backend and frontend to server: " + ssh_ip)
        web_files.send_files_to_server(ssh_ip, ssh_user, ssh_password)
        print("success\n")

        # извлекаем архивы в нужные папки
        print("Install code")
        web_files.extract_server(ssh_ip, ssh_user, ssh_password)
        print("success\n")

