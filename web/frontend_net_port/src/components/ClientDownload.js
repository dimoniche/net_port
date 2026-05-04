import React from 'react';
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
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import ComputerIcon from '@mui/icons-material/Computer';

const ClientDownload = () => {
  // Client files available for download - only compiled Linux 64-bit client
  const clientFiles = [
    {
      id: 1,
      name: 'Linux (64-bit)',
      filename: 'module_net_port_client-0.0.3',
      description: 'Клиент для Linux 64-bit',
      icon: <ComputerIcon />,
      platform: 'Linux',
      architecture: 'x64',
      size: '~99 KB',
      color: 'success',
    },
  ];

  // Service file
  const serviceFile = {
    id: 3,
    name: 'Systemd Service',
    filename: 'net_port.service',
    description: 'Файл службы systemd для автоматического запуска сервера',
    icon: <ComputerIcon />,
    platform: 'Linux',
    size: '~2 KB',
    color: 'info',
  };

  // SSL certificate generated during Docker image build
  const sslFile = {
    id: 4,
    name: 'SSL Certificate (server.crt)',
    filename: 'server.crt',
    description: 'Сертификат для безопасного подключения клиента к серверу',
    icon: <ComputerIcon />,
    platform: 'All',
    size: '~1.3 KB',
    color: 'warning',
  };

  const handleDownload = (filename, fileType = 'regular') => {
    // Open file in new tab for download
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

  return (
    <Box sx={{ mt: 3 }}>

      <Typography variant="h5" gutterBottom>
        Клиенты для скачивания
      </Typography>

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
                  <Chip
                    label={client.platform}
                    size="small"
                    sx={{ mr: 1, mb: 1 }}
                  />
                  <Chip
                    label={client.architecture}
                    size="small"
                    sx={{ mr: 1, mb: 1 }}
                    color="secondary"
                  />
                  <Chip
                    label={client.size}
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
                  onClick={() => handleDownload(client.filename, "build")}
                  sx={{ mx: 1, mb: 1 }}
                >
                  Скачать
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Divider sx={{ my: 4 }} />

      <Typography variant="h5" gutterBottom>
        Дополнительные файлы
      </Typography>

      <Grid container spacing={3}>
        {/* Systemd Service File */}
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

              <Box sx={{ mt: 2 }}>
                <Chip
                  label={serviceFile.platform}
                  size="small"
                  sx={{ mr: 1, mb: 1 }}
                />
                <Chip
                  label={serviceFile.size}
                  size="small"
                  sx={{ mb: 1 }}
                  variant="outlined"
                />
              </Box>
            </CardContent>

            <CardActions>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={() => handleDownload(serviceFile.filename, 'regular')}
                sx={{ mx: 1, mb: 1 }}
              >
                Скачать конфигурацию
              </Button>
            </CardActions>
          </Card>
        </Grid>

        {/* SSL Certificate */}
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

              <Box sx={{ mt: 2 }}>
                <Chip
                  label={sslFile.platform}
                  size="small"
                  sx={{ mr: 1, mb: 1 }}
                />
                <Chip
                  label={sslFile.size}
                  size="small"
                  sx={{ mb: 1 }}
                  variant="outlined"
                />
              </Box>
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

      <Box sx={{ mt: 4, p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
        <Typography variant="subtitle2" gutterBottom>
          Инструкция по установке:
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          1. Скачайте клиент
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          2. Для Linux: сделайте файл исполняемым: <code>chmod +x module_net_port_client-0.0.3</code>
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          3. Запустите клиент с параметрами сервера
        </Typography>
        <Typography variant="body2" color="text.secondary">
          4. Для автоматического запуска сервера используйте файл службы systemd
        </Typography>
      </Box>
    </Box>
  );
};

export default ClientDownload;