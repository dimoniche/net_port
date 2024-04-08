import paramiko
import tarfile
import os.path

def send_files_to_server(ip, user, password):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(hostname=ip, port=22, username=user, password=password)
    ftp_client = client.open_sftp()

    print("Send backend")
    ftp_client.put("result\\backend.tgz", '/root/backend.tgz')
    print("Send frontend")
    ftp_client.put("result\\frontend.tgz", '/root/frontend.tgz')

    ftp_client.close()


def extract_server(ip, user, password):
    port = 22
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(hostname=ip, username=user, password=password, port=port)

    # останавливаем backend
    print("Stop backend")
    stdin, stdout, stderr = client.exec_command('systemctl stop start net_port_ui')
    status_command = stdout.channel.recv_exit_status()
    # удаляем папку с backend
    print("Delete folder Backend")
    stdin, stdout, stderr = client.exec_command('rm -r /root/net_port_ui')
    status_command = stdout.channel.recv_exit_status()
    # Распаковываем backend
    print("Extract backend")
    stdin, stdout, stderr = client.exec_command('tar -C /root/net_port_ui/ -xf /root/backend.tgz')
    status_command = stdout.channel.recv_exit_status()
    # запускаем backend
    print("Start Backend")
    stdin, stdout, stderr = client.exec_command('systemctl start net_port_ui')
    status_command = stdout.channel.recv_exit_status()

    print("Backend is started...")
    print("Path: /root\n")

    # удаляем папку с frontend
    print("Delete old frontend")
    stdin, stdout, stderr = client.exec_command('rm -r /var/www/net_port/*')
    status_command = stdout.channel.recv_exit_status()
    # Распаковываем frontend
    print("Extract frontend")
    stdin, stdout, stderr = client.exec_command('tar -C /root/ -xf /root/frontend.tgz')
    status_command = stdout.channel.recv_exit_status()
    stdin, stdout, stderr = client.exec_command('cp -rf /root/build/* /var/www/net_port')
    status_command = stdout.channel.recv_exit_status()
    stdin, stdout, stderr = client.exec_command('rm -rf /root/build')
    status_command = stdout.channel.recv_exit_status()

    print("Frontend is extracted...")
    print("Path: /var/www/netport/\n")


def make_tarfile(output_filename, source_dir):
    with tarfile.open(output_filename, "w:gz") as tar:
        tar.add(source_dir, arcname=os.path.basename(source_dir))
