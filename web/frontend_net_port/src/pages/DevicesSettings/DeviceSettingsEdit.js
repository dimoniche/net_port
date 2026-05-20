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
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import updateAbility from "../../config/permission";

const InputFieldWidth = { width: "100%" };

const DeviceSettingsEdit = ({ children, ...rest }) => {
    const deviceId = useParams();
    const { api } = useContext(ApiContext);
    const history = useNavigate();
    const [cookies, , removeCookie] = useCookies();

    const [, setSubmitting] = useState(false);
    const [isChangedData, setChangedData] = useState(false);
    const [addError, setAddError] = useState(false);
    const [deviceData, setDeviceData] = useState();

    const [error, setError] = useState(null);
    if (error) {
        throw error;
    }

    useEffect(() => {
        const abortController = new AbortController();

        async function fetchData(abortController) {
            let response_error = false;
            setChangedData(false);

            const device = await api
                .get(`/devices/${deviceId.id}`, {
                    signal: abortController.signal,
                })
                .catch((err) => {
                    if (err.response?.status === 401) {
                        handleLogout();
                    } else {
                        setError(err);
                    }
                    response_error = true;
                });

            if (response_error) return;
            if (abortController.signal.aborted) return;

            setDeviceData(device);
        }

        fetchData(abortController);

        return () => {
            abortController.abort();
        };
    }, [deviceId.id]);

    const handleLogout = () => {
        removeCookie("user", { path: "/" });
        removeCookie("accessToken", { path: "/" });
        history("/");
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setSubmitting(true);
        setAddError(false);

        const formData = new FormData(event.target);
        const internalPortRaw = formData.get("internal_port");
        let internalPort = null;
        if (internalPortRaw && internalPortRaw.toString().trim() !== "") {
            const parsed = parseInt(internalPortRaw);
            if (!isNaN(parsed)) {
                internalPort = parsed;
            }
        }
        const updatedDeviceData = {
            name: formData.get("name"),
            description: formData.get("description"),
            type: formData.get("type"),
            status: formData.get("status") || "inactive",
            internal_address: formData.get("internal_address"),
            internal_port: internalPort,
            protocol: formData.get("protocol"),
        };

        try {
            const response = await api.patch(`/devices/${deviceId.id}`, updatedDeviceData);
            if (response.status === 200) {
                history("/devices");
            } else {
                setAddError(true);
            }
        } catch (error) {
            setAddError(true);
        } finally {
            setSubmitting(false);
        }
    };

    const handleCancel = () => {
        history("/devices");
    };

    if (!deviceData) {
        return <div>Загрузка...</div>;
    }

    return (
        <Box sx={{ p: 3 }}>
            <Paper sx={{ p: 3 }}>
                <h2>Редактировать устройство</h2>
                {addError && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        <AlertTitle>Ошибка</AlertTitle>
                        Не удалось обновить устройство
                    </Alert>
                )}
                <form onSubmit={handleSubmit}>
                    <Grid container spacing={2}>
                        <Grid item xs={12} md={6}>
                            <TextField
                                fullWidth
                                required
                                label="ID устройства"
                                name="device_id"
                                variant="outlined"
                                defaultValue={deviceData.device_id}
                                InputProps={{
                                    readOnly: true,
                                }}
                                helperText="Уникальный идентификатор устройства (нельзя изменить)"
                            />
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <TextField
                                fullWidth
                                label="Название"
                                name="name"
                                variant="outlined"
                                defaultValue={deviceData.name}
                                helperText="Название устройства"
                            />
                        </Grid>
                        <Grid item xs={12}>
                            <TextField
                                fullWidth
                                label="Описание"
                                name="description"
                                variant="outlined"
                                multiline
                                rows={2}
                                defaultValue={deviceData.description}
                                helperText="Описание устройства"
                            />
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <TextField
                                fullWidth
                                label="Тип"
                                name="type"
                                variant="outlined"
                                defaultValue={deviceData.type || "iot_gateway"}
                                select
                                SelectProps={{ native: true }}
                                helperText="Тип устройства"
                            >
                                <option value="iot_gateway">IoT Шлюз</option>
                                <option value="sensor">Датчик</option>
                                <option value="controller">Контроллер</option>
                            </TextField>
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <TextField
                                fullWidth
                                label="Статус"
                                name="status"
                                variant="outlined"
                                defaultValue={deviceData.status || "inactive"}
                                select
                                SelectProps={{ native: true }}
                                helperText="Статус устройства"
                            >
                                <option value="active">Активно</option>
                                <option value="inactive">Неактивно</option>
                                <option value="pending">Ожидание</option>
                                <option value="error">Ошибка</option>
                            </TextField>
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <TextField
                                fullWidth
                                label="Внутренний адрес"
                                name="internal_address"
                                variant="outlined"
                                defaultValue={deviceData.internal_address}
                                helperText="IP или хост устройства внутри сети"
                            />
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <TextField
                                fullWidth
                                label="Внутренний порт"
                                name="internal_port"
                                variant="outlined"
                                type="number"
                                inputProps={{ min: 1, max: 65535 }}
                                defaultValue={deviceData.internal_port}
                                helperText="Порт устройства внутри сети"
                            />
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <TextField
                                fullWidth
                                label="Протокол"
                                name="protocol"
                                variant="outlined"
                                defaultValue={deviceData.protocol || "tcp"}
                                select
                                SelectProps={{ native: true }}
                                helperText="Протокол устройства"
                            >
                                <option value="tcp">TCP</option>
                                <option value="udp">UDP</option>
                            </TextField>
                        </Grid>
                        <Grid item xs={12}>
                            <Divider sx={{ my: 2 }} />
                            <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 2 }}>
                                <Button variant="outlined" onClick={handleCancel}>
                                    Отмена
                                </Button>
                                <Button type="submit" variant="contained" color="primary">
                                    Сохранить
                                </Button>
                            </Box>
                        </Grid>
                    </Grid>
                </form>
            </Paper>
        </Box>
    );
};

export default DeviceSettingsEdit;