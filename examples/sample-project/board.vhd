-- board.vhd — 555 astable blinker: the timer drives an LED through a resistor.
--
--   R1 (1k)   VCC → DISCH          timing, sets the short half of the period
--   R2 (68k)  DISCH → THRESH/TRIG  timing, sets the long half
--   C1 (10uF) THRESH/TRIG → GND    timing capacitor
--   C2 (10nF) CTRL → GND           control-voltage bypass
--   R3 (330R) OUT → LED anode      LED current limit
--
-- f ≈ 1.44 / ((R1 + 2·R2) · C1) ≈ 1.05 Hz, so the LED blinks about once a second.
library ieee;
use ieee.std_logic_1164.all;

entity board is
  port (
    VCC : in std_logic;
    GND : in std_logic
  );
end entity;

architecture rtl of board is
  signal n_out    : std_logic;
  signal n_disch  : std_logic;
  signal n_timing : std_logic;
  signal n_ctrl   : std_logic;
  signal n_led    : std_logic;
begin
  -- The timer itself: threshold and trigger are tied together (astable mode)
  -- and reset is held high, so it free-runs.
  U1 : entity work.NE555
    generic map (PACKAGE_VARIANT => "DIP8")
    port map (
      GND    => GND,
      TRIG   => n_timing,
      OUT    => n_out,
      RESET  => VCC,
      CTRL   => n_ctrl,
      THRESH => n_timing,
      DISCH  => n_disch,
      VCC    => VCC
    );

  R1 : entity work.RESISTOR_1K
    generic map (PACKAGE_VARIANT => "R0603")
    port map (
      P1 => VCC,
      P2 => n_disch
    );

  R2 : entity work.RESISTOR_68K
    generic map (PACKAGE_VARIANT => "R0603")
    port map (
      P1 => n_disch,
      P2 => n_timing
    );

  C1 : entity work.CAPACITOR_10U
    generic map (PACKAGE_VARIANT => "C1206")
    port map (
      Pos => n_timing,
      Neg => GND
    );

  C2 : entity work.CAPACITOR_10N
    generic map (PACKAGE_VARIANT => "C0603")
    port map (
      P1 => n_ctrl,
      P2 => GND
    );

  R3 : entity work.RESISTOR_330
    generic map (PACKAGE_VARIANT => "R0603")
    port map (
      P1 => n_out,
      P2 => n_led
    );

  D1 : entity work.LED_RED
    generic map (PACKAGE_VARIANT => "LED0603")
    port map (
      A => n_led,
      K => GND
    );
end architecture;