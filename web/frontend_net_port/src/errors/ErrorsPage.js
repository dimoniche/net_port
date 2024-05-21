/* eslint-disable eqeqeq */
import React from "react";
import isEmpty from 'lodash/isEmpty';
import { useNavigate } from 'react-router-dom';

import Button from '@mui/material/Button';
import ButtonGroup from '@mui/material/ButtonGroup';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';

const ErrorsPage = (props) => {
    const history = useNavigate();
    
    const goBack = () => {
        if(props.resetError != undefined)props.resetError();
        history(-1);
    };

    return (
        <>
            <Paper sx={{ mb: 2, p: 2, flexGrow: 1 }}>
                <Typography
                    sx={{ mb: 1, pl: 1 }}
                    component="div"
                    variant='h6'
                >
                {isEmpty(props.message) ? "Что то пошло не так..." : props.message}
                </Typography>
                <Divider
                    sx={{ mb: 1 }}
                />
                <ButtonGroup>
                    <Button
                        variant='contained'
                        color="primary"
                        onClick={props.resetError}
                    >
                        Перезагрузить
                    </Button>
                    <Button
                        onClick={goBack}
                    >
                        Назад
                    </Button>
                </ButtonGroup>
            </Paper>
        </>
    );
};

export default ErrorsPage;
