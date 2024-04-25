/* eslint-disable eqeqeq */
import React, { useContext, useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { ApiContext } from "../../context/ApiContext";
import { useNavigate } from "react-router-dom";
import { useFormik } from "formik";
import { useCookies } from "react-cookie";
import * as Yup from "yup";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Paper from "@mui/material/Paper";
import isEmpty from "lodash/isEmpty";
import updateAbility from "../../config/permission";

const InputFieldWidth = { width: "100%" };

const NewServerSettingsData = ({ children, ...rest }) => {
    const serverId = useParams();
    const { api } = useContext(ApiContext);
    const history = useNavigate();
    const [cookies, , removeCookie] = useCookies();

    const [isSubmitting, setSubmitting] = useState(false);
    const [isChangedData, setChangedData] = useState(false);
    const [addError, setAddError] = useState(false);
    const [serverData, setServerData] = useState();

    const [freePorts, setFreePorts] = useState();

    const [error, setError] = useState(null);
    if (error) {
        throw error;
    }

    useEffect(() => {
        const abortController = new AbortController();

        async function fetchData(abortController) {
            let response_error = false;

            let ports_all = [];

            for (let i = 6000; i < 7000; i++) {
                ports_all.push(i);
            }

            const input = await api
                .get(`/servers?inputports=true`)
                .catch((err) => {
                    if (err.response.status === 401) {
                        handleLogout();
                    } else {
                        setError(err);
                    }
                    response_error = true;
                });

            const output = await api
                .get(`/servers?outputports=true`)
                .catch((err) => {
                    if (err.response.status === 401) {
                        handleLogout();
                    } else {
                        setError(err);
                    }
                    response_error = true;
                });

            if (response_error) return;
            if (abortController.signal.aborted) return;

            if (input.status == 200 && output.status == 200) {
                let input_all = [];
                input.data.forEach((item) => {
                    input_all.push(item.input_port);
                });

                let output_all = [];
                output.data.forEach((item) => {
                    output_all.push(item.output_port);
                });

                let difference = ports_all.filter(
                    (x) => !input_all.includes(x) && !output_all.includes(x)
                );

                setFreePorts(difference);

                formik.values.input_port = difference[0];
                formik.values.output_port = difference[1];
            }
        }

        fetchData(abortController);

        return () => {
            //abortController.abort();
        };
    }, []);

    const handleLogout = () => {
        removeCookie("token");
        removeCookie("user");

        api.delete(`/authentication`).catch((err) => {});

        history("/main");
        updateAbility(rest.ability, null);
    };

    const formHandler = async (values) => {
        formik.handleSubmit();

        setSubmitting(true);
        setAddError(false);

        var data;
        data = {
            input_port: formik.values.input_port,
            output_port: formik.values.output_port,
            description: formik.values.description,
            user_id: cookies.user.id,
            enable: true,
        };

        try {
            api.post(`/servers`, data)
                .then((response) => {
                    setSubmitting(false);
                    history(-1);
                })
                .catch((error) => {
                    console.error(error.response);
                    if (error.response.status == 422) {
                    }
                    if (error.response.status === 401) {
                        handleLogout();
                    }
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
    };

    const InitValues = {
        input_port: "",
        output_port: "",
        description: "",
    };

    let Schema = Yup.object({
        input_port: Yup.number()
            .integer()
            .test(
                "input_port",
                "Порт занят",
                (val) => !isEmpty(freePorts) && freePorts.includes(val)
            ),
        output_port: Yup.number().required(),
        description: Yup.string(),
    });

    const formik = useFormik({
        initialValues: InitValues,
        validationSchema: Schema,
    });

    return (
        <Paper
            sx={{
                mt: 1,
                mb: 1,
                p: 2,
                bottom: "0",
                display: "flex",
                flexDirection: "column",
                maxWidth: 800,
            }}
        >
            <span>
                <b>Настройки нового сервера</b>
            </span>
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
                            value={formik.values.input_port || ""}
                            error={
                                formik.touched.input_port &&
                                Boolean(formik.errors.input_port)
                            }
                            disabled={
                                cookies.user.role_name == "admin" ? false : true
                            }
                        ></TextField>
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
                            value={formik.values.output_port || ""}
                            error={
                                formik.touched.output_port &&
                                Boolean(formik.errors.output_port)
                            }
                            disabled={
                                cookies.user.role_name == "admin" ? false : true
                            }
                        ></TextField>
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
                            value={formik.values.description || ""}
                            error={
                                formik.touched.description &&
                                Boolean(formik.errors.description)
                            }
                        ></TextField>
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
                        {addError && (
                            <Alert
                                severity="error"
                                variant="filled"
                                onClose={() => {
                                    setAddError(false);
                                }}
                            >
                                <AlertTitle>Ошибка</AlertTitle>
                                Ошибка при сохранении настроек сервера
                            </Alert>
                        )}
                    </Grid>
                </Grid>
            </Box>
        </Paper>
    );
};

export default NewServerSettingsData;
