import React from 'react';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import NavItem from './NavItem';

const NavBlock = ({navData, ability}) => (
    <Box
        sx={{
            display: 'flex',
            flexDirection: 'column',
        }}
    >
        <List>
            {navData.map(({href, title, name}) => (
                <NavItem
                    key={href}
                    href={href}
                    title={title}
                /> 
            ))}
        </List>
    </Box>
);

export default NavBlock;
