import React from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";

const DevicePortBadges = ({
    device,
    emptyLabel = "Не назначен",
    stackWidth = 96,
}) => {
    const activePort = device.assigned_port || device.session_port;
    const displayPort = activePort || device.preferred_port;

    if (!displayPort) {
        return emptyLabel;
    }

    return (
        <Box
            sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "stretch",
                gap: 0.5,
                width: stackWidth,
            }}
        >
            <Chip
                label={String(displayPort)}
                size="small"
                variant="outlined"
                sx={{ justifyContent: "center" }}
            />
            {!activePort && device.preferred_port ? (
                <Chip
                    label="зарезерв."
                    size="small"
                    variant="outlined"
                    sx={{ justifyContent: "center" }}
                />
            ) : null}
            {device.preferred_port && activePort === device.preferred_port ? (
                <Chip
                    label="фикс."
                    size="small"
                    color="info"
                    variant="outlined"
                    sx={{ justifyContent: "center" }}
                />
            ) : null}
        </Box>
    );
};

export default DevicePortBadges;
