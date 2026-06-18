export const isAdminUser = (user) =>
    user?.role_name === "admin" || user?.role === "admin";
