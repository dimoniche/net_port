import React, { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCookies } from "react-cookie";
import { ApiContext } from "../../context/ApiContext";
import { useFormik } from "formik";
import CommonDialog from "../../components/CommonDialog";
import updateAbility from "../../config/permission";

import Box from "@mui/material/Box";
import * as Yup from "yup";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Paper from "@mui/material/Paper";
import isEmpty from "lodash/isEmpty";
import OutlinedInput from "@mui/material/OutlinedInput";
import InputLabel from "@mui/material/InputLabel";
import InputAdornment from "@mui/material/InputAdornment";
import IconButton from "@mui/material/IconButton";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import FormControl from "@mui/material/FormControl";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";

const InputFieldWidth = { width: "100%" };

const isAdmin = (user) => user?.role_name === "admin" || user?.role === "admin";

const NewUserSettingsData = ({ closeHandle, ...props }) => {
    const { api } = useContext(ApiContext);
    const [cookies, , removeCookie] = useCookies();
    const history = useNavigate();
    const isPageMode = typeof closeHandle !== "function";

    const [isSubmitting, setSubmitting] = useState(false);
    const [isChangedData, setChangedData] = useState(false);
    const [addError, setAddError] = useState(false);
    const [wrongPassword, setWrongPassword] = useState(false);
    const [error, setError] = useState(null);

    const [showPassword, setShowPassword] = useState(false);
    const [showRePassword, setShowRePassword] = useState(false);

    useEffect(() => {
        if (isPageMode && !isAdmin(cookies.user)) {
            history("/main");
        }
    }, [cookies.user, history, isPageMode]);

    const handleLogout = () => {
        removeCookie("token");
        removeCookie("user");
        api.delete(`/authentication`).catch(() => {});
        history("/main");
        updateAbility(props.ability, null);
    };

    const handleSuccess = () => {
        if (isPageMode) {
            history("/users");
            return;
        }
        closeHandle();
    };

    const handleCancel = () => {
        if (isPageMode) {
            history("/users");
            return;
        }
        closeHandle();
    };

    const formHandler = async () => {
        if (isEmpty(formik.values.password)) {
            setAddError(true);
            return;
        }

        if (formik.values.password !== formik.values.repassword) {
            setWrongPassword(true);
            return;
        }

        const data = {
            login: formik.values.login,
            password: formik.values.password,
            username: formik.values.username,
            email: formik.values.email,
            phone: formik.values.phone,
            role_name: formik.values.role_name,
        };

        setSubmitting(true);
        setAddError(false);

        try {
            await api.post(`/users`, data);
            setSubmitting(false);
            handleSuccess();
        } catch (requestError) {
            console.error(requestError);
            if (requestError.response?.status === 401) {
                handleLogout();
            }
            setSubmitting(false);
            setAddError(true);
        }
    };

    const Schema = Yup.object({
        login: Yup.string().required("Укажите логин"),
        password: Yup.string().min(6, "Минимум 6 символов").required("Укажите пароль"),
        repassword: Yup.string().required("Повторите пароль"),
        username: Yup.string(),
        email: Yup.string().email("Некорректный email"),
        phone: Yup.string(),
        role_name: Yup.string().oneOf(["admin", "user"]),
    });

    const formik = useFormik({
        initialValues: {
            login: "",
            password: "",
            repassword: "",
            username: "",
            email: "",
            phone: "",
            role_name: "user",
        },
        validationSchema: Schema,
        onSubmit: formHandler,
    });

    const handleClickShowPassword = () => setShowPassword((show) => !show);
    const handleClickShowRePassword = () => setShowRePassword((show) => !show);

    if (error) {
        throw error;
    }

    if (isPageMode && !isAdmin(cookies.user)) {
        return null;
    }

    return (
        <Box sx={{ p: isPageMode ? 2 : 0, maxWidth: 900, mx: isPageMode ? 0 : "auto" }}>
            <Paper
                sx={{
                    p: 3,
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                <Typography variant="h5" sx={{ mb: 1 }}>
                    Новый пользователь
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Создание учётной записи для доступа к веб-интерфейсу и устройствам.
                </Typography>
                <Box component="form" onSubmit={formik.handleSubmit}>
                    <Divider sx={{ mb: 2 }} />
                    <Grid container spacing={2}>
                        <Grid item xs={12} md={6}>
                            <TextField
                                sx={InputFieldWidth}
                                label="Логин"
                                name="login"
                                value={formik.values.login}
                                onChange={(event) => {
                                    formik.handleChange(event);
                                    setChangedData(true);
                                }}
                                error={formik.touched.login && Boolean(formik.errors.login)}
                                helperText={formik.touched.login && formik.errors.login}
                                disabled={isSubmitting}
                            />
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <FormControl fullWidth>
                                <InputLabel id="role-name-label">Роль</InputLabel>
                                <Select
                                    labelId="role-name-label"
                                    label="Роль"
                                    name="role_name"
                                    value={formik.values.role_name}
                                    onChange={(event) => {
                                        formik.handleChange(event);
                                        setChangedData(true);
                                    }}
                                    disabled={isSubmitting}
                                >
                                    <MenuItem value="user">Пользователь</MenuItem>
                                    <MenuItem value="admin">Администратор</MenuItem>
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <FormControl fullWidth variant="outlined">
                                <InputLabel htmlFor="new-user-password">Пароль</InputLabel>
                                <OutlinedInput
                                    sx={InputFieldWidth}
                                    label="Пароль"
                                    name="password"
                                    value={formik.values.password}
                                    onChange={(event) => {
                                        formik.handleChange(event);
                                        setChangedData(true);
                                    }}
                                    error={formik.touched.password && Boolean(formik.errors.password)}
                                    id="new-user-password"
                                    type={showPassword ? "text" : "password"}
                                    disabled={isSubmitting}
                                    endAdornment={
                                        <InputAdornment position="end">
                                            <IconButton
                                                aria-label="toggle password visibility"
                                                onClick={handleClickShowPassword}
                                                edge="end"
                                            >
                                                {showPassword ? <VisibilityOff /> : <Visibility />}
                                            </IconButton>
                                        </InputAdornment>
                                    }
                                />
                            </FormControl>
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <FormControl fullWidth variant="outlined">
                                <InputLabel htmlFor="new-user-repassword">
                                    Повторите пароль
                                </InputLabel>
                                <OutlinedInput
                                    sx={InputFieldWidth}
                                    label="Повторите пароль"
                                    name="repassword"
                                    value={formik.values.repassword}
                                    onChange={(event) => {
                                        formik.handleChange(event);
                                        setChangedData(true);
                                    }}
                                    error={
                                        formik.touched.repassword &&
                                        Boolean(formik.errors.repassword)
                                    }
                                    id="new-user-repassword"
                                    type={showRePassword ? "text" : "password"}
                                    disabled={isSubmitting}
                                    endAdornment={
                                        <InputAdornment position="end">
                                            <IconButton
                                                aria-label="toggle password visibility"
                                                onClick={handleClickShowRePassword}
                                                edge="end"
                                            >
                                                {showRePassword ? <VisibilityOff /> : <Visibility />}
                                            </IconButton>
                                        </InputAdornment>
                                    }
                                />
                            </FormControl>
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <TextField
                                sx={InputFieldWidth}
                                label="Имя пользователя"
                                name="username"
                                value={formik.values.username}
                                onChange={(event) => {
                                    formik.handleChange(event);
                                    setChangedData(true);
                                }}
                                disabled={isSubmitting}
                            />
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <TextField
                                sx={InputFieldWidth}
                                label="Email"
                                name="email"
                                value={formik.values.email}
                                onChange={(event) => {
                                    formik.handleChange(event);
                                    setChangedData(true);
                                }}
                                error={formik.touched.email && Boolean(formik.errors.email)}
                                helperText={formik.touched.email && formik.errors.email}
                                disabled={isSubmitting}
                            />
                        </Grid>
                        {addError && (
                            <Grid item xs={12}>
                                <Alert
                                    severity="error"
                                    variant="filled"
                                    onClose={() => setAddError(false)}
                                >
                                    <AlertTitle>Ошибка</AlertTitle>
                                    Не удалось создать пользователя. Проверьте данные —
                                    возможно, такой логин уже существует.
                                </Alert>
                            </Grid>
                        )}
                        <Grid item xs={12}>
                            <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
                                <Button
                                    color="primary"
                                    disabled={!isChangedData || isSubmitting}
                                    type="submit"
                                    variant="contained"
                                >
                                    Добавить
                                </Button>
                                <Button
                                    variant="outlined"
                                    disabled={isSubmitting}
                                    onClick={handleCancel}
                                >
                                    Отмена
                                </Button>
                            </Box>
                        </Grid>
                    </Grid>
                </Box>
            </Paper>
            <CommonDialog
                open={wrongPassword}
                title="Ошибка"
                text="Введенные пароли не совпали."
                handleCancel={() => setWrongPassword(false)}
                handleSubmit={() => setWrongPassword(false)}
            />
        </Box>
    );
};

export default NewUserSettingsData;
