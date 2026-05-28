import React, { useContext, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardActions,
  Typography,
  Button,
  Grid,
  Chip,
  Divider,
  Alert,
  CircularProgress,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import ComputerIcon from '@mui/icons-material/Computer';
import { ApiContext } from '../context/ApiContext';
import {
  CLIENT_BINARY_NAME,
  CLIENT_DOWNLOAD_CATALOG,
  CLIENT_VERSION_LABEL,
} from '../consts/client';
import { formatBytes } from '../utils/statsFormat';

async function fetchBuildFileSizeBytes(filename) {
  try {
    const response = await fetch(`/files/build/${encodeURIComponent(filename)}`, {
      method: 'HEAD',
    });
    if (!response.ok) {
      return null;
    }
    const length = response.headers.get('content-length');
    return length ? Number(length) : null;
  } catch {
    return null;
  }
}

async function enrichClientDownloads(downloads) {
  return Promise.all(
    downloads.map(async ({ filename, sizeBytes }) => {
      const meta = CLIENT_DOWNLOAD_CATALOG[filename];
      if (!meta) {
        return null;
      }

      let resolvedSize = sizeBytes;
      if (resolvedSize == null || Number.isNaN(resolvedSize)) {
        resolvedSize = await fetchBuildFileSizeBytes(filename);
      }

      return {
        ...meta,
        sizeBytes: resolvedSize,
        sizeLabel:
          resolvedSize != null && resolvedSize > 0
            ? formatBytes(resolvedSize)
            : '—',
        icon: <ComputerIcon />,
      };
    })
  ).then((items) => items.filter(Boolean));
}

const ClientDownload = () => {
  const { api } = useContext(ApiContext);
  const [clientFiles, setClientFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const fetchAvailableClients = async () => {
      setIsLoading(true);
      setLoadError(null);

      try {
        const response = await api.get('/clients/downloads');
        if (cancelled) {
          return;
        }

        let downloads = response.data?.downloads;
        if (!downloads?.length && response.data?.files?.length) {
          downloads = response.data.files.map((filename) => ({ filename }));
        }

        const available = await enrichClientDownloads(downloads || []);
        if (!cancelled) {
          setClientFiles(available);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err);
          setClientFiles([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchAvailableClients();

    return () => {
      cancelled = true;
    };
  }, [api]);

  const primaryClientFilename = clientFiles[0]?.filename || CLIENT_BINARY_NAME;

  const serviceFile = {
    id: 3,
    name: 'Systemd Service (пример)',
    filename: 'net_port.service',
    description: 'Пример unit-файла systemd (режим legacy proxy, при необходимости отредактируйте)',
    icon: <ComputerIcon />,
    platform: 'Linux',
    size: '~2 KB',
    color: 'info',
  };

  const sslFile = {
    id: 4,
    name: 'SSL Certificate (server.crt)',
    filename: 'server.crt',
    description: 'Сертификат сервера (если требуется для legacy SSL-режима)',
    icon: <ComputerIcon />,
    platform: 'All',
    size: '~1.3 KB',
    color: 'warning',
  };

  const handleDownload = (filename, fileType = 'regular') => {
    let path;
    switch (fileType) {
      case 'build':
        path = `/files/build/${filename}`;
        break;
      case 'ssl':
        path = `/files/ssl/${filename}`;
        break;
      default:
        path = `/files/${filename}`;
    }
    window.open(path, '_blank');
  };

  const deviceExample = useMemo(
    () => `./${primaryClientFilename} \\
  --device-id DEVICE_ID \\
  --device-token TOKEN \\
  --registration-server SERVER_IP \\
  --registration-port 8443 \\
  --port-host-base 49000`,
    [primaryClientFilename]
  );

  return (
    <Box sx={{ mt: 3, px: { xs: 1, sm: 2 } }}>
      <Alert severity="info" sx={{ mb: 3 }}>
        Актуальная версия клиента: <strong>{CLIENT_VERSION_LABEL}</strong>. Скачайте бинарник ниже,
        создайте устройство в разделе «Устройства», скопируйте <code>device_id</code> и токен,
        затем запустите клиент на хосте устройства.
      </Alert>

      {loadError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Не удалось получить список клиентов с сервера. Обновите страницу.
        </Alert>
      )}

      <Typography variant="h5" gutterBottom>
        Клиент для скачивания
      </Typography>

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={32} />
        </Box>
      ) : clientFiles.length === 0 ? (
        <Alert severity="warning" sx={{ mb: 3 }}>
          На сервере нет доступных бинарников клиента. Соберите образ или добавьте файлы в{' '}
          <code>artifacts/clients/</code> перед <code>docker build</code>.
        </Alert>
      ) : (
        <Grid container spacing={3}>
          {clientFiles.map((client) => (
            <Grid item xs={12} sm={6} md={4} key={client.id}>
              <Card
                sx={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'transform 0.2s',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: 6,
                  },
                }}
              >
                <CardContent sx={{ flexGrow: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Box sx={{ mr: 2, color: `${client.color}.main` }}>
                      {client.icon}
                    </Box>
                    <Typography variant="h6" component="div">
                      {client.name}
                    </Typography>
                  </Box>

                  <Typography variant="body2" color="text.secondary" paragraph>
                    {client.description}
                  </Typography>

                  <Box sx={{ mt: 2 }}>
                    <Chip label={client.platform} size="small" sx={{ mr: 1, mb: 1 }} />
                    <Chip
                      label={client.architecture}
                      size="small"
                      sx={{ mr: 1, mb: 1 }}
                      color="secondary"
                    />
                    <Chip
                    label={client.sizeLabel}
                    size="small"
                    sx={{ mb: 1 }}
                    variant="outlined"
                  />
                  </Box>
                </CardContent>

                <CardActions>
                  <Button
                    fullWidth
                    variant="contained"
                    startIcon={<DownloadIcon />}
                    onClick={() => handleDownload(client.filename, 'build')}
                    sx={{ mx: 1, mb: 1 }}
                  >
                    Скачать
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {clientFiles.length > 0 && (
        <>
          <Divider sx={{ my: 4 }} />

          <Typography variant="h6" gutterBottom>
            Установка и запуск (устройство)
          </Typography>

          <Box
            component="pre"
            sx={{
              p: 2,
              bgcolor: 'grey.900',
              color: 'grey.100',
              borderRadius: 1,
              overflow: 'auto',
              fontSize: '0.8rem',
              mb: 2,
            }}
          >
            {`chmod +x ${primaryClientFilename}

${deviceExample}`}
          </Box>

          <Typography variant="body2" color="text.secondary" paragraph>
            <code>SERVER_IP</code> — адрес сервера Net Port. <code>--registration-port 8443</code> —
            порт регистрации устройств. <code>--port-host-base</code> нужен, если клиент в Docker или за
            NAT: внешний порт хоста для туннеля (например 49000 при пробросе 49000:6000).
          </Typography>
        </>
      )}

      <Divider sx={{ my: 4 }} />

      <Typography variant="h5" gutterBottom>
        Дополнительные файлы
      </Typography>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card
            sx={{
              display: 'flex',
              flexDirection: 'column',
              transition: 'transform 0.2s',
              '&:hover': {
                transform: 'translateY(-4px)',
                boxShadow: 6,
              },
            }}
          >
            <CardContent sx={{ flexGrow: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Box sx={{ mr: 2, color: 'info.main' }}>
                  <ComputerIcon />
                </Box>
                <Typography variant="h6" component="div">
                  {serviceFile.name}
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" paragraph>
                {serviceFile.description}
              </Typography>
              <Chip label={serviceFile.platform} size="small" sx={{ mr: 1 }} />
              <Chip label={serviceFile.size} size="small" variant="outlined" />
            </CardContent>
            <CardActions>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={() => handleDownload(serviceFile.filename, 'regular')}
                sx={{ mx: 1, mb: 1 }}
              >
                Скачать
              </Button>
            </CardActions>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card
            sx={{
              display: 'flex',
              flexDirection: 'column',
              transition: 'transform 0.2s',
              '&:hover': {
                transform: 'translateY(-4px)',
                boxShadow: 6,
              },
            }}
          >
            <CardContent sx={{ flexGrow: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Box sx={{ mr: 2, color: 'warning.main' }}>
                  <ComputerIcon />
                </Box>
                <Typography variant="h6" component="div">
                  {sslFile.name}
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" paragraph>
                {sslFile.description}
              </Typography>
              <Chip label={sslFile.platform} size="small" sx={{ mr: 1 }} />
              <Chip label={sslFile.size} size="small" variant="outlined" />
            </CardContent>
            <CardActions>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={() => handleDownload(sslFile.filename, 'ssl')}
                sx={{ mx: 1, mb: 1 }}
              >
                Скачать сертификат
              </Button>
            </CardActions>
          </Card>
        </Grid>
      </Grid>

      {clientFiles.length > 0 && (
        <Box sx={{ mt: 4, p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
          <Typography variant="subtitle2" gutterBottom>
            Краткая инструкция
          </Typography>
          <Typography variant="body2" color="text.secondary" component="ol" sx={{ pl: 2, m: 0 }}>
            <li>Скачайте клиент {primaryClientFilename}</li>
            <li>
              <code>chmod +x {primaryClientFilename}</code>
            </li>
            <li>Создайте устройство в веб-интерфейсе и нажмите «Подключить»</li>
            <li>Подставьте device_id, token и IP сервера в команду запуска</li>
            <li>Убедитесь, что на сервере открыты порты 8443 и диапазон туннелей (6000–7000 или проброс)</li>
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default ClientDownload;
