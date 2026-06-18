import React from "react";

import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";

import { filterFieldSx } from "../theme/filterLayout";

const FilterSelect = ({ label, value, onChange, children, sx }) => (
    <FormControl fullWidth size="small" sx={{ ...filterFieldSx, ...sx }}>
        <InputLabel shrink>{label}</InputLabel>
        <Select
            value={value}
            label={label}
            onChange={onChange}
            displayEmpty
            sx={{ fontSize: "0.875rem" }}
        >
            {children}
        </Select>
    </FormControl>
);

export default FilterSelect;
