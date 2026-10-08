import React from 'react';

interface CurateLogoProps {
  className?: string;
  size?: number;
}

export const CurateLogo: React.FC<CurateLogoProps> = ({
  className = 'w-6 h-6',
  size,
}) => {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="currentColor"
      className={className}
      style={size ? { width: size, height: size } : undefined}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Curate Logo"
    >
      {/* 
        Official Curate Brand Mark:
        Ribbon bookmark with dynamic stylized 'c' loop, central counter, and upward arrow
      */}
      {/* Top-left hood */}
      <path d="M 22 18 C 22 13.5 25 10 30 10 L 70 10 C 75 10 78 13.5 78 18 L 78 20 C 74 15 65 11 54 11 C 41 11 31 19 25 32 C 23 37 22 42 22 45 Z" />

      {/* Central oval island */}
      <path d="M 51 11.5 C 62.5 11.5 68.5 22 66.5 35 C 64.5 48 53.5 57 42 57 C 32.5 57 28.5 47 30.5 34 C 32.5 21 40 11.5 51 11.5 Z" />

      {/* Arrow on the right */}
      <path d="M 78 17 L 63.5 39.5 L 76 32.5 L 78 32.5 Z" />

      {/* Bottom bookmark ribbon */}
      <path d="M 22 59 C 28 62 42 63.5 56 62.5 C 67 61.5 74 58 78 57 L 78 86 C 78 88.5 75.5 90 73.5 88.5 L 50 69.5 L 26.5 88.5 C 24.5 90 22 88.5 22 86 Z" />
    </svg>
  );
};
