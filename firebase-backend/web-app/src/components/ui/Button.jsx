import React from 'react';
import styles from './Button.module.css';

export const Button = ({
    children,
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    className = '',
    disabled,
    isLoading,
    ...props
}) => {
    const classes = [
        styles.button,
        styles[variant],
        styles[size],
        fullWidth ? styles.fullWidth : '',
        disabled || isLoading ? styles.disabled : '',
        className
    ].join(' ');

    return (
        <button className={classes} disabled={disabled || isLoading} {...props}>
            {isLoading ? <span className="animate-spin">⌛</span> : null}
            {children}
        </button>
    );
};
