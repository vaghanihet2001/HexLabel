import React from 'react';
import { Toaster } from 'react-hot-toast';
import { useTheme } from './ThemeContext';

const ToastConfig = () => {
    const { theme, themeColors } = useTheme();

    return (
        <Toaster
            position="bottom-right"
            toastOptions={{
                style: {
                    background: themeColors.cardBg,
                    color: themeColors.text,
                    border: `1px solid ${themeColors.border}`,
                },
                success: {
                    iconTheme: {
                        primary: themeColors.primary,
                        secondary: themeColors.cardBg,
                    },
                },
                error: {
                    iconTheme: {
                        primary: themeColors.error,
                        secondary: themeColors.cardBg,
                    },
                },
            }}
        />
    );
};

export default ToastConfig;
