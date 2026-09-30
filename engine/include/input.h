#ifndef ADVANCE_INPUT_H
#define ADVANCE_INPUT_H

#include <stdint.h>

/* Bit layout matches the GBA's REG_KEYINPUT register. */
#define INPUT_A       0x0001
#define INPUT_B       0x0002
#define INPUT_SELECT  0x0004
#define INPUT_START   0x0008
#define INPUT_RIGHT   0x0010
#define INPUT_LEFT    0x0020
#define INPUT_UP      0x0040
#define INPUT_DOWN    0x0080
#define INPUT_R       0x0100
#define INPUT_L       0x0200

#define INPUT_DPAD    (INPUT_UP | INPUT_DOWN | INPUT_LEFT | INPUT_RIGHT)
#define INPUT_ALL     0x03FF

void input_init(void);

/* Call once per frame, before reading any buttons. */
void input_update(void);

/* Bitmask of every button currently held. */
uint16_t input_held_mask(void);

/* Held this frame. */
int input_held(uint16_t key);

/* Went down this frame (wasn't held last frame). */
int input_pressed(uint16_t key);

/* Went up this frame (was held last frame). */
int input_released(uint16_t key);

/* Old name for input_pressed, kept so existing code still builds. */
int input_down(uint16_t key);

/* For the next `frames` frames, presses of A/B/START/SELECT don't count
 * (dialogue uses it so one press can't skip a box or open another). */
void input_block_presses(int frames);

#endif
