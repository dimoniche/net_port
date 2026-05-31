import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCookies } from "react-cookie";
import isEmpty from "lodash/isEmpty";

import { ApiContext } from "../context/ApiContext";
import { Loader } from "../components/Loader";
import CommonDialog from "../components/CommonDialog";
import updateAbility from "../config/permission";

import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TableContainer from "@mui/material/TableContainer";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Alert from "@mui/material/Alert";

import AddIcon from "@mui/icons-material/Add";
import RefreshIcon from "@mui/icons-material/Refresh";
import DeleteIcon from "@mui/icons-material/Delete";

import { StyledTableCell, StyledTableRow } from "../theme/TableTheme";

const isAdmin = (user) => user?.role_name === "admin" || user?.role === "admin";

const Users = ({ ...rest }) => {
    const { api } = useContext(ApiContext);
    const [cookies, , removeCookie] = useCookies();
    const history = useNavigate();

    const [users, setUsers] = useState([]);
    const [isLoaded, setIsLoaded] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleteError, setDeleteError] = useState(null);

    const handleLogout = useCallback(() => {
        removeCookie("token");
        removeCookie("user");
        api.delete(`/authentication`).catch(() => {});
        history("/main");
        updateAbility(rest.ability, null);
    }, [api, history, removeCookie, rest.ability]);

    const fetchUsers = useCallback(async (signal) => {
        if (isEmpty(cookies.user)) {
            history("/main");
            return;
        }

        if (!isAdmin(cookies.user)) {
            history("/main");
            return;
        }

        setIsRefreshing(true);
        try {
            const response = await api.get("/users", {
                params: { $limit: 100, $sort: { login: 1 } },
                signal,
            });
            const rows = Array.isArray(response.data?.data)
                ? response.data.data
                : Array.isArray(response.data)
                    ? response.data
                    : [];
            setUsers(rows);
            setIsLoaded(true);
            setError(null);
        } catch (err) {
            if (err.response?.status === 401) {
                handleLogout();
            } else {
                setError(err);
            }
        } finally {
            setIsRefreshing(false);
        }
    }, [api, cookies.user, handleLogout, history]);

    useEffect(() => {
        const abortController = new AbortController();
        fetchUsers(abortController.signal);
        return () => abortController.abort();
    }, [fetchUsers]);

    const handleDelete = async () => {
        if (!deleteTarget) {
            return;
        }

        setDeleteError(null);
        try {
            await api.delete(`/users/${deleteTarget.id}`);
            setDeleteTarget(null);
            await fetchUsers();
        } catch (err) {
            setDeleteError(
                err.response?.data?.message ||
                    "Не удалось удалить пользователя"
            );
        }
    };

    const roleLabel = useMemo(
        () => ({
            admin: "Администратор",
            user: "Пользователь",
        }),
        []
    );

    if (error) {
        throw error;
    }

    if (!isAdmin(cookies.user)) {
        return (
            <Box sx={{ p: 3 }}>
                <Alert severity="warning">Доступ только для администратора</Alert>
            </Box>
        );
    }

    if (!isLoaded) {
        return <Loader title="Загрузка пользователей" />;
    }

    return (
        <Box sx={{ p: 2 }}>
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    mb: 2,
                    gap: 2,
                    flexWrap: "wrap",
                }}
            >
                <Typography variant="h5">Пользователи</Typography>
                <Box sx={{ display: "flex", gap: 1 }}>
                    <Button
                        variant="outlined"
                        startIcon={<RefreshIcon />}
                        onClick={() => fetchUsers()}
                        disabled={isRefreshing}
                    >
                        Обновить
                    </Button>
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={() => history("/users/new")}
                    >
                        Добавить
                    </Button>
                </Box>
            </Box>

            {deleteError && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setDeleteError(null)}>
                    {deleteError}
                </Alert>
            )}

            <TableContainer component={Paper}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <StyledTableCell>Логин</StyledTableCell>
                            <StyledTableCell>Имя</StyledTableCell>
                            <StyledTableCell>Email</StyledTableCell>
                            <StyledTableCell>Роль</StyledTableCell>
                            <StyledTableCell align="right">Действия</StyledTableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {users.map((user) => (
                            <StyledTableRow key={user.id}>
                                <TableCell>{user.login}</TableCell>
                                <TableCell>{user.username || "—"}</TableCell>
                                <TableCell>{user.email || "—"}</TableCell>
                                <TableCell>
                                    <Chip
                                        size="small"
                                        label={roleLabel[user.role_name] || user.role_name || "—"}
                                        color={user.role_name === "admin" ? "primary" : "default"}
                                    />
                                </TableCell>
                                <TableCell align="right">
                                    {user.login !== "admin" && Number(user.id) !== Number(cookies.user.id) ? (
                                        <Tooltip title="Удалить">
                                            <IconButton
                                                color="error"
                                                size="small"
                                                onClick={() => setDeleteTarget(user)}
                                            >
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    ) : null}
                                </TableCell>
                            </StyledTableRow>
                        ))}
                        {users.length === 0 && (
                            <StyledTableRow>
                                <TableCell colSpan={5} align="center">
                                    Пользователи не найдены
                                </TableCell>
                            </StyledTableRow>
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            <CommonDialog
                open={Boolean(deleteTarget)}
                title="Удалить пользователя"
                text={`Удалить пользователя «${deleteTarget?.login || ""}»?`}
                handleCancel={() => setDeleteTarget(null)}
                handleSubmit={handleDelete}
            />
        </Box>
    );
};

export default Users;
