import React from 'react';
import styles from './Badge.module.css';

export const Badge = ({
    children,
    variant = 'neutral', // neutral, success, warning, danger, info, pro, outlineSuccess, outlineWarning, outlineDanger
    dot = false,
    className = ''
}) => {
    const classes = [
        styles.badge,
        styles[variant],
        dot ? styles.dot : '',
        className
    ].filter(Boolean).join(' ');

    return (
        <span className={classes}>
            {!dot && children}
        </span>
    );
};
