-- led_red.prt.ehd — red indicator LED, 0603 / 0805.
library ieee;
use ieee.std_logic_1164.all;

package led_red_pkg is
  type led_red_pin is (K, A);
  type pin_map is array (led_red_pin) of natural;

  -- pin 1 is the cathode on chip LEDs, pin 2 the anode.
  constant LED_RED_LED0603 : pin_map := (K => 1, A => 2);
  constant LED_RED_LED0805 : pin_map := (K => 1, A => 2);

  constant LED_RED_LED0603_FP : string := "LEDC1608X55N";
  constant LED_RED_LED0805_FP : string := "LEDC2012X80N";

  constant LED_RED_COLOR  : string := "red";
  constant LED_RED_MFR    : string := "Generic";
  constant LED_RED_PARTNUM : string := "LTST-C171KRKT";
end package;

library ieee;
use ieee.std_logic_1164.all;

entity LED_RED is
  generic (
    PACKAGE_VARIANT : string := "LED0603"
  );
  port (
    K : inout std_logic;
    A : inout std_logic
  );
end entity;

architecture rtl of LED_RED is
begin
end architecture;