import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography'
import { useNavigate } from 'react-router-dom';

const NotFound = () => {
    const history = useNavigate();

    return(
        <Box
            sx={{
                backgroundColor: 'background.default',
                left: '0',
                bottom: '0',
                position: 'absolute',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                width: '100%',
                justifyContent: 'center',
            }}
        >
            <Container maxWidth="md">
                <Typography
                    align="center"
                    color="textPrimary"
                    variant="h1"
                >
                    404
                </Typography>
                <Typography
                    align="center"
                    color="textPrimary"
                    variant="subtitle2"
                >
                    Страница не найдена
                </Typography>
                <Box
                    sx={{
                        mt: 3,
                        textAlign: "center"
                    }}
                >
                    <Button
                        onClick={() => history.push('/')}
                        variant="contained"
                    >назад</Button>
                </Box>
            </Container>
        </Box>
    )
};

export default NotFound;
