import React from 'react';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import NavItem from './NavItem';
import { Can } from "./Abilities";

const NavBlock = ({navData, ability}) => (
    <Box
        sx={{
            display: 'flex',
            flexDirection: 'column',
        }}
    >
        <List>
            {navData.map(({href, title, name}) => (
                <Can I="read" a={name} passThrough key={name + title}>
                {allowed => (
                    allowed ? 
                    <NavItem
                        key={href}
                        href={href}
                        title={title}
                    /> : <></>
                )}
                </Can>
            ))}
        </List>
    </Box>
);

export default NavBlock;
