/* eslint-disable eqeqeq */
import React, { useContext, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiContext } from "../../context/ApiContext";
import { useCookies } from "react-cookie";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Paper from "@mui/material/Paper";
import isEmpty from "lodash/isEmpty";

const NewDeviceSettingsData = ({ children, ...rest }) => {
    const { api } = useContext(ApiContext);
    const history = useNavigate();
    const [cookies] = useCookies();

    const [isSubmitting, setSubmitting] = useState(false);
    const [addError, setAddError] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");

    const handleSubmit = async (event) => {
        event.preventDefault();
        setSubmitting(true);
        setAddError(false);
        setErrorMessage("");

        const formData = new FormData(event.target);
        const deviceData = {
            device_id: formData.get("device_id"),
            name: formData.get("name"),
            description: formData.get("description"),
            type: formData.get("type") || "iot_gateway",
            status: "inactive",
            user_id: cookies.user?.id,
        };

        try {
            const response = await api.post("/devices", deviceData);
            if (response.status === 201) {
                history("/devices");
            } else {
                setAddError(true);
                setErrorMessage(response.data?.message || "Failed to create device");
            }
        } catch (error) {
            setAddError(true);
            setErrorMessage(error.response?.data?.message || error.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleCancel = () => {
        history("/devices");
    };

    return (
        <Box sx={{ p: 3 }}>
            <Paper sx={{ p: 3 }}>
                <h2>Добавить новое устройство</h2>
                {addError && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        <AlertTitle>Ошибка</AlertTitle>
                        {errorMessage}
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
                                helperText="Уникальный идентификатор устройства"
                            />
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <TextField
                                fullWidth
                                label="Название"
                                name="name"
                                variant="outlined"
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
                            />
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <TextField
                                fullWidth
                                label="Тип"
                                name="type"
                                variant="outlined"
                                defaultValue="iot_gateway"
                                select
                                SelectProps={{ native: true }}
                            >
                                <option value="iot_gateway">IoT Шлюз</option>
                                <option value="sensor">Датчик</option>
                                <option value="controller">Контроллер</option>
                            </TextField>
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <TextField
                                fullWidth
                                label="Внутренний адрес"
                                name="internal_address"
                                variant="outlined"
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
                            />
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <TextField
                                fullWidth
                                label="Протокол"
                                name="protocol"
                                variant="outlined"
                                defaultValue="tcp"
                                select
                                SelectProps={{ native: true }}
                            >
                                <option value="tcp">TCP</option>
                                <option value="udp">UDP</option>
                            </TextField>
                        </Grid>
                    </Grid>
                    <Box sx={{ mt: 3, display: "flex", gap: 2 }}>
                        <Button
                            variant="contained"
                            color="primary"
                            type="submit"
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? "Создание..." : "Создать устройство"}
                        </Button>
                        <Button
                            variant="outlined"
                            color="secondary"
                            onClick={handleCancel}
                        >
                            Отмена
                        </Button>
                    </Box>
                </form>
            </Paper>
        </Box>
    );
};

export default NewDeviceSettingsData;