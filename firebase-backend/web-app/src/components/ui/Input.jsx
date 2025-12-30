import React from 'react';
import styles from './Input.module.css';

export const Input = ({
    label,
    error,
    icon: Icon,
    className = '',
    ...props
}) => {
    return (
        <div className={`${styles.wrapper} ${className}`}>
            {label && <label className={styles.label}>{label}</label>}
            <div className={styles.inputWrapper}>
                {Icon && <Icon size={18} className={styles.icon} />}
                <input
                    className={`${styles.input} ${Icon ? styles.hasIcon : ''} ${error ? styles.error : ''}`}
                    {...props}
                />
            </div>
            {error && <span className={styles.errorText}>{error}</span>}
        </div>
    );
};
