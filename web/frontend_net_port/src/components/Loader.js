import React from 'react';
import Paper from '@mui/material/Paper';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';

const Loader = ({ title }) => (
    <Paper sx={{
        mt: 1,
        mb: 1,
        p: 2,
        left: '0',
        bottom: '0',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        width: 800
    }}>
        <Container maxWidth="sm">
            <Typography align="center">{title}</Typography>
        </Container>
    </Paper>
);

export { Loader };
