/*
 * The bits of devkitPro's libsysbase that gba_crt0.o expects, for the
 * Linux build's toolchain (Arm's own arm-none-eabi GCC, which runs on
 * older glibc than devkitPro's Linux GCC does - see
 * tools/linux-toolchain/assemble.sh). gba_crt0 points fake_heap_end at
 * the end of EWRAM; a newlib _sbrk over that range keeps malloc working
 * if a game ever uses it.
 */
#include <errno.h>
#include <stddef.h>

char *fake_heap_start = 0;
char *fake_heap_end = 0;

extern char __end__[];

void *_sbrk(ptrdiff_t incr)
{
    static char *heap = 0;
    if (!heap)
        heap = fake_heap_start ? fake_heap_start : __end__;
    if (fake_heap_end && heap + incr > fake_heap_end)
    {
        errno = ENOMEM;
        return (void *)-1;
    }
    char *prev = heap;
    heap += incr;
    return prev;
}

void __sync_synchronize_none(void)
{
}
