import React from 'react';
import {
    NavLink,
    matchPath,
    useLocation
} from 'react-router-dom';
import Button from '@mui/material/Button';
import ListItem from '@mui/material/ListItem';

const NavItem = ({
    href,
    title,
    ...rest
}) => {
    const location = useLocation();

    const active = href ? !!matchPath({
        path: href
    }, location.pathname) : false;

    return (
        <ListItem
            sx={{
                display: 'flex',
                py: 0
            }}
            {...rest}
        >
            <Button
                component={NavLink}
                sx={{
                    color: 'text.secondary',
                    fontWeight: 'medium',
                    justifyContent: 'flex-start',
                    letterSpacing: 0,
                    py: 1.25,
                    textTransform: 'none',
                    width: '100%',
                    ...(active && {
                        color: 'primary.main'
                    }),
                    '& svg': {
                        mr: 1
                    }
                }}
                to={href}
            >
                <span>
                    {title}
                </span>
            </Button>
        </ListItem>
    );
};

export default NavItem;
