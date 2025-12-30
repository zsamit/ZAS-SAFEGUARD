import React from 'react';
import styles from './Toggle.module.css';

export const Toggle = ({
    label,
    description,
    checked,
    onChange,
    disabled,
    locked,
    className = ''
}) => {
    const wrapperClasses = [
        styles.toggleWrapper,
        checked ? styles.checked : '',
        disabled ? styles.disabled : '',
        locked ? styles.locked : '',
        className
    ].filter(Boolean).join(' ');

    const handleClick = () => {
        if (disabled || locked) return;
        onChange?.(!checked);
    };

    return (
        <div
            className={wrapperClasses}
            onClick={handleClick}
            role="switch"
            aria-checked={checked}
            tabIndex={disabled ? -1 : 0}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleClick();
                }
            }}
        >
            {(label || description) && (
                <div className={styles.labelContainer}>
                    {label && <span className={styles.label}>{label}</span>}
                    {description && <span className={styles.description}>{description}</span>}
                </div>
            )}
            <div className={styles.switch} />
        </div>
    );
};
