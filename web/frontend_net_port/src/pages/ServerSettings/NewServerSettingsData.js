/* eslint-disable eqeqeq */
import React, { useContext, useState, useEffect } from 'react';
import { useParams } from "react-router-dom";
import { ApiContext } from '../../context/ApiContext';
import { useNavigate } from 'react-router-dom';
import { useFormik } from 'formik';
import { useCookies } from 'react-cookie';
import * as Yup from 'yup';
import Button from "@mui/material/Button";
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Paper from '@mui/material/Paper';
import isEmpty from 'lodash/isEmpty';

const InputFieldWidth = { width: '100%' };

const NewServerSettingsData = () => {
    const serverId = useParams();
    const { api } = useContext(ApiContext);
    const history = useNavigate();
    const [cookies] = useCookies();

    const [isSubmitting, setSubmitting] = useState(false);
    const [isChangedData, setChangedData] = useState(false);
    const [addError, setAddError] = useState(false);
    const [serverData, setServerData] = useState();

    const [error, setError] = useState(null);
    if (error) {
        throw error;
    }

    useEffect(() => {

    }, [])

    const formHandler = async (values) => {
        setSubmitting(true);
        setAddError(false);

        var data;
        data = { 
            input_port: formik.values.input_port, 
            output_port: formik.values.output_port, 
            description: formik.values.description,
            user_id: cookies.user.id
        };

        try {
            api.post(`/servers`, data)
                .then(response => {
                    setSubmitting(false);
                    history(-1);
                })
                .catch(error => {
                    console.error(error.response);
                    if (error.response.status == 422) {

                    }
                    if (error.response.status === 401) setError(error);
                    setSubmitting(false);
                    setAddError(true);
                });
        } catch (error) {
            setError(error);
            setAddError(true);
            console.log(JSON.stringify(error.message));
        }
    };

    const formReset = async (values) => {
        history(-1);
    }

    const InitValues = {
        input_port: "",
        output_port: "",
        description: "",
    };

    let Schema = Yup.object({
        input_port: Yup.number().required(),
        output_port: Yup.number().required(),
        description: Yup.string(),
    });

    const formik = useFormik({
        initialValues: InitValues,
        validationSchema: Schema,
    });

    return (
                        <Paper sx={{
                            mt: 1,
                            mb: 1,
                            p: 2,
                            bottom: '0',
                            display: 'flex',
                            flexDirection: 'column',
                        }}>
                            <span>Настройки нового сервера</span>
                            <Box sx={{ mt: 2, flexGrow: 1 }}>
                            <Grid container spacing={1}>
                                <Divider sx={{ mb: 2 }} />
                                <Grid item xs={6}>
                                <TextField
                                    sx={InputFieldWidth}
                                    label="Входящий порт"
                                    variant="outlined"
                                    onChange={formik.handleChange}
                                    onKeyUp={() => {
                                        setChangedData(true);
                                    }}
                                    name="input_port"
                                    value={formik.values.input_port || ''}
                                    error={formik.touched.input_port && Boolean(formik.errors.input_port)}
                                >
                                </TextField>
                                </Grid>
                                <Grid item xs={6}>
                                <TextField
                                    sx={InputFieldWidth}
                                    label="Перенаправляемый порт"
                                    variant="outlined"
                                    onChange={formik.handleChange}
                                    onKeyUp={() => {
                                        setChangedData(true);
                                    }}
                                    name="output_port"
                                    value={formik.values.output_port || ''}
                                    error={formik.touched.output_port && Boolean(formik.errors.output_port)}
                                >
                                </TextField>
                                </Grid>
                                <Grid item xs={6}>
                                <TextField
                                    sx={InputFieldWidth}
                                    label="Описание сервера"
                                    variant="outlined"
                                    onChange={formik.handleChange}
                                    onKeyUp={() => {
                                        setChangedData(true);
                                    }}
                                    name="description"
                                    value={formik.values.description || ''}
                                    error={formik.touched.description && Boolean(formik.errors.description)}
                                >
                                </TextField>
                                </Grid>
                                <Grid item xs={6}></Grid>
                                <Grid item xs={6}>
                                    <Button
                                        color="primary"
                                        disabled={!isChangedData}
                                        size="large"
                                        type="submit"
                                        variant="contained"
                                        onClick={formHandler}
                                    >
                                        Сохранить
                                    </Button>
                                    <> </>
                                    <Button
                                        size="large"
                                        variant="outlined"
                                        type="reset"
                                        onClick={formReset}
                                    >
                                        Отмена
                                    </Button>
                                </Grid>
                                <Grid item xs={6}>
                                    {addError && <Alert
                                        severity="error"
                                        variant="filled"
                                        onClose={() => {
                                            setAddError(false);
                                        }}
                                    >
                                        <AlertTitle>Ошибка</AlertTitle>
                                        Ошибка при сохранении настроек сервера
                                    </Alert>}
                                </Grid>
                            </Grid>
                            </Box>
                        </Paper>
    );
};

export default NewServerSettingsData;