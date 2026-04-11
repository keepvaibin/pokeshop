'use client';

import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-bold text-pkmn-text mb-1">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`w-full bg-white border border-[#adb5bd] text-pkmn-text p-2 text-xs
            focus:outline-none focus:border-pkmn-blue focus:ring-1 focus:ring-pkmn-blue
            ${error ? 'border-pkmn-red' : ''}
            ${className}`}
          {...props}
        />
        {error && (
          <p className="text-pkmn-red text-sm mt-1">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
export default Input;
