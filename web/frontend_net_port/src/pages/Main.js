import React from "react";

import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Grid from "@mui/material/Grid";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";

const Main = () => {
    return (
        <Grid container spacing={2}>
            <Grid item xs={12}>
                <Paper sx={{ maxWidth: 960, p: 3 }}>
                    <Typography variant="h5" gutterBottom>
                        Net Port — доступ к устройствам без белого IP
                    </Typography>

                    <Typography paragraph>
                        Сервис организует защищённый туннель между удалённым устройством и
                        сервером Net Port. Клиент на устройстве поддерживает постоянное
                        соединение с сервером регистрации, а пользователь подключается к
                        локальному сервису на устройстве через выделенный внешний порт —
                        без необходимости выдавать устройству публичный IP-адрес.
                    </Typography>

                    <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>
                        Как это работает
                    </Typography>

                    <Box component="ol" sx={{ pl: 3, m: 0 }}>
                        <Typography component="li" paragraph>
                            В разделе <b>Устройства</b> создайте устройство и сохраните
                            одноразовый токен авторизации.
                        </Typography>
                        <Typography component="li" paragraph>
                            Запустите клиент <code>module_net_port_client</code> на устройстве
                            с указанием <code>device-id</code>, <code>device-token</code> и
                            адреса сервера регистрации.
                        </Typography>
                        <Typography component="li" paragraph>
                            После регистрации сервер назначает пару портов: входящий (SSH/сервис
                            на устройстве) и туннельный. Подключайтесь к входящему порту с
                            внешней стороны — трафик будет передан на устройство.
                        </Typography>
                        <Typography component="li" paragraph>
                            Статусы устройств и статистика трафика обновляются в веб-интерфейсе
                            в реальном времени через WebSocket.
                        </Typography>
                    </Box>

                    <Divider sx={{ my: 2 }} />

                    <Typography variant="h6" gutterBottom>
                        Пример запуска клиента
                    </Typography>

                    <Box
                        component="pre"
                        sx={{
                            p: 2,
                            bgcolor: "grey.100",
                            borderRadius: 1,
                            overflowX: "auto",
                            fontFamily: "monospace",
                            fontSize: "0.875rem",
                            m: 0,
                        }}
                    >
{`./module_net_port_client --device-id DEVICE_ID --device-token TOKEN \\
  --registration-server SERVER_IP --registration-port 8443 \\
  --port-host-base 49000`}
                    </Box>

                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                        <b>--registration-server</b> — адрес сервера Net Port.
                        <br />
                        <b>--registration-port</b> — порт регистрации устройств (по умолчанию 8443).
                    </Typography>

                    <Divider sx={{ my: 2 }} />

                    <Typography variant="h6" gutterBottom>
                        Порты и параметр --port-host-base
                    </Typography>

                    <Typography paragraph>
                        После регистрации сервер назначает пару портов в диапазоне{" "}
                        <b>6000–7000</b>. Для одного устройства, как правило:
                    </Typography>

                    <Box component="ul" sx={{ pl: 3, mt: 0, mb: 2 }}>
                        <Typography component="li" paragraph sx={{ mb: 0.5 }}>
                            <b>Входящий порт</b> (например, 6000) — к нему подключается
                            пользователь снаружи (SSH, другой TCP-сервис).
                        </Typography>
                        <Typography component="li" paragraph>
                            <b>Туннельный порт</b> (например, 6001) — к нему подключается
                            клиент на устройстве и держит обратный канал.
                        </Typography>
                    </Box>

                    <Typography paragraph>
                        Параметр <b>--port-host-base</b> нужен, когда внутренние порты сервера
                        (6000, 6001, …) снаружи хоста опубликованы под другими номерами.
                        Типичный случай — Docker: в <code>docker-compose.yml</code> проброс{" "}
                        <code>49000-49099:6000-6099</code> означает, что снаружи доступны
                        49000 вместо 6000, 49001 вместо 6001 и т.д.
                    </Typography>

                    <Typography paragraph>
                        Клиент, запущенный <b>вне контейнера</b>, не может подключиться к{" "}
                        <code>SERVER_IP:6001</code>, если с хоста открыт только{" "}
                        <code>49001</code>. С <code>--port-host-base 49000</code> клиент
                        сам переводит внутренний порт в опубликованный:
                    </Typography>

                    <Box
                        component="pre"
                        sx={{
                            p: 2,
                            bgcolor: "grey.100",
                            borderRadius: 1,
                            overflowX: "auto",
                            fontFamily: "monospace",
                            fontSize: "0.875rem",
                            m: 0,
                        }}
                    >
{`внешний_порт = port-host-base + (внутренний_порт - 6000)

Пример: туннель 6001 → 49000 + (6001 - 6000) = 49001
        входящий 6000 → 49000 + (6000 - 6000) = 49000`}
                    </Box>

                    <Typography paragraph sx={{ mt: 2 }}>
                        <b>Кто куда подключается:</b>
                    </Typography>

                    <Box
                        component="pre"
                        sx={{
                            p: 2,
                            bgcolor: "grey.100",
                            borderRadius: 1,
                            overflowX: "auto",
                            fontFamily: "monospace",
                            fontSize: "0.875rem",
                            m: 0,
                        }}
                    >
{`[Пользователь / SSH]  →  SERVER:49000  →  сервер:6000  →  туннель  →  устройство:22
[Клиент на устройстве]  →  SERVER:49001  →  сервер:6001  (держит туннель открытым)`}
                    </Box>

                    <Typography paragraph sx={{ mt: 2 }}>
                        <b>Когда --port-host-base не нужен:</b> клиент запущен на том же хосте,
                        где слушают порты 6000/6001 напрямую, или эти порты доступны с машины
                        клиента без проброса (без Docker/NAT). Тогда клиент использует порты
                        из ответа регистрации как есть.
                    </Typography>

                    <Divider sx={{ my: 2 }} />

                    <Typography variant="h6" gutterBottom>
                        Разделы веб-интерфейса
                    </Typography>

                    <Typography component="div" paragraph>
                        <b>Устройства</b> — регистрация, подключение и отключение устройств,
                        просмотр назначенных портов и статуса online.
                        <br />
                        <b>Статистика</b> — трафик и активные соединения по серверам и
                        устройствам с автообновлением.
                        <br />
                        <b>Серверы</b> — настройка портов и параметров серверов доступа
                        (для администратора).
                    </Typography>

                    <Typography variant="body2" color="text.secondary">
                        Клиент, SSL-сертификат и файл systemd-службы доступны для
                        скачивания в разделе <b>Настройки</b>.
                    </Typography>
                </Paper>
            </Grid>
        </Grid>
    );
};

export default Main;
