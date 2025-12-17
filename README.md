Сервис форвардинга сетевых портов, для возможности подключения сетевых устройств не имеющих белого IP адреса.

SSL режим

Клиент                          Сервер
  |                              |
  |-------- SSL Connect -------->|
  |                              |
  | Проверяет сертификат сервера |
  |                              | Принимает SSL соединение
  |                              | (не требует сертификат клиента)
  |<----- SSL Established -------|
  |                              |
  |====== Secure Channel ========|

Запуск

# Без SSL
./module_net_port_server-0.0.3 --no-db --input-port 5000 --output-port 5001

# С SSL (и указанием сертификатов)
./module_net_port_server-0.0.3 --no-db --input-port 5000 --output-port 5001 --enable-ssl --cert
./module_net_port_server-0.0.3 --no-db --input-port 5000 --output-port 5001

