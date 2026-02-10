import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';
import { useTheme } from '../components/ThemeContext';

const MySwal = withReactContent(Swal);

export const useSwal = () => {
    const { themeColors, theme } = useTheme();

    const fire = (options) => {
        return MySwal.fire({
            background: themeColors.cardBg,
            color: themeColors.text,
            confirmButtonColor: themeColors.primary,
            cancelButtonColor: themeColors.error,
            ...options,
            customClass: {
                popup: 'swal2-custom-popup',
                ...options.customClass,
            },
        });
    };

    return { fire, Swal: MySwal };
};
