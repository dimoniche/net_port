import React from 'react';

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';

const CommonDialog = ({ open, title, text, handleSubmit, handleCancel }) => {
    return (
        <div>
            <Dialog
                open={open}
                onClose={handleCancel}
                aria-labelledby="alert-dialog-title"
                aria-describedby="alert-dialog-description"
            >
                <DialogTitle id="alert-dialog-title">
                    {title}
                </DialogTitle>
                <DialogContent>
                    <DialogContentText id="alert-dialog-description">
                        {text}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={handleCancel}
                    >
                        Отмена
                    </Button>
                    <Button
                        variant="contained"
                        onClick={handleSubmit}
                        autoFocus
                    >
                        ОК
                    </Button>
                </DialogActions>
            </Dialog>
        </div>
    );
}

export default CommonDialog;
