import React from 'react';
import styles from './Card.module.css';

export const Card = ({
    children,
    className = '',
    hoverable = false,
    variant = 'default', // default, glass, flat, success, warning, danger, info
    noPadding = false,
    compact = false,
    onClick,
    ...props
}) => {
    const classes = [
        styles.card,
        hoverable ? styles.hoverable : '',
        variant !== 'default' ? styles[variant] : '',
        noPadding ? styles.noPadding : '',
        compact ? styles.compact : '',
        className
    ].filter(Boolean).join(' ');

    return (
        <div
            className={classes}
            onClick={onClick}
            tabIndex={hoverable ? 0 : undefined}
            role={hoverable ? 'button' : undefined}
            {...props}
        >
            {children}
        </div>
    );
};
