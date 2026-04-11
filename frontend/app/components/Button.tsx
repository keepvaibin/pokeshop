'use client';

import { ButtonHTMLAttributes, forwardRef } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'blue' | 'yellow' | 'red' | 'outline';
  size?: 'sm' | 'md' | 'lg';
}

const variants = {
  blue: 'bg-pkmn-blue text-white hover:bg-pkmn-blue-dark',
  yellow: 'bg-pkmn-yellow text-black hover:bg-pkmn-yellow-dark',
  red: 'bg-pkmn-red text-white hover:bg-pkmn-red-dark',
  outline: 'bg-white text-pkmn-text border border-pkmn-border hover:bg-black hover:text-white',
};

const sizes = {
  sm: 'text-[14px] px-6 py-2',
  md: 'text-[20px] px-5 py-5',
  lg: 'text-base px-5 py-[.625rem] w-full',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'blue', size = 'md', className = '', disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={`font-heading font-bold uppercase leading-[1.2] tracking-wide
          transition-[background-color,color] duration-[120ms] ease-out
          border border-transparent text-center inline-block
          ${variants[variant]}
          ${sizes[size]}
          ${disabled ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}
          ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
export default Button;
