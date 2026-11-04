#ifndef TEST_GBA_H
#define TEST_GBA_H
/* Host-only declarations; hardware code is discarded by the test linker. */
#define IRQ_VBLANK 1
#define MODE_0 0
#define BG0_ENABLE 0x100
#define OBJ_ENABLE 0x1000
#define OBJ_1D_MAP 0x40
#define EWRAM_BSS
extern unsigned short REG_DISPCNT;
extern unsigned short REG_BLDCNT;
extern unsigned short REG_BLDALPHA;
void irqInit(void);
void irqEnable(int);
void VBlankIntrWait(void);
#endif
