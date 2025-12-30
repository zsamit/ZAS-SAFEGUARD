import React from 'react';
import { Link } from 'react-router-dom';

/**
 * ZAS Safeguard Logo Component
 * Enterprise-grade inline SVG wordmark following locked brand guidelines
 * 
 * Props:
 * - variant: 'white' | 'black' (default: 'white')
 * - size: 'sm' | 'md' | 'lg' (default: 'md')
 * - linkTo: path to link to (default: null, no link)
 */
export const Logo = ({
    variant = 'white',
    size = 'md',
    linkTo = null,
}) => {
    const fill = variant === 'white' ? '#FFFFFF' : '#0D0D0D';

    // Sizes following enterprise standards
    // sm: sidebar/footer (20-24px), md: header (28-32px), lg: hero (36-40px)
    const heights = {
        sm: 20,
        md: 28,
        lg: 36,
    };

    const height = heights[size];
    const width = height * 6; // Aspect ratio ~6:1 for wordmark

    const LogoSVG = () => (
        <svg
            viewBox="0 0 180 30"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ height: `${height}px`, width: 'auto' }}
            aria-label="ZAS Safeguard"
            role="img"
        >
            {/* ZAS - Inter Bold 700, tight kerning -1% */}
            <text
                x="0"
                y="22"
                fill={fill}
                style={{
                    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
                    fontWeight: 700,
                    fontSize: '24px',
                    letterSpacing: '-0.01em'
                }}
            >
                ZAS
            </text>

            {/* Vertical divider - 1.5px, 85% height */}
            <rect
                x="50"
                y="4"
                width="1.5"
                height="21"
                fill={fill}
                opacity="0.85"
            />

            {/* SAFEGUARD - Inter Medium 500, +4% tracking */}
            <text
                x="60"
                y="21"
                fill={fill}
                style={{
                    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
                    fontWeight: 500,
                    fontSize: '14px',
                    letterSpacing: '0.04em'
                }}
            >
                SAFEGUARD
            </text>
        </svg>
    );

    if (linkTo) {
        return (
            <Link
                to={linkTo}
                style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
            >
                <LogoSVG />
            </Link>
        );
    }

    return <LogoSVG />;
};

export default Logo;
