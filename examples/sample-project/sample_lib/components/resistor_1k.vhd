-- resistor_1k.prt.ehd — 1k chip resistor (R1 in the blinker).
library ieee;
use ieee.std_logic_1164.all;

package resistor_1k_pkg is
  type resistor_1k_pin is (P1, P2);
  type pin_map is array (resistor_1k_pin) of natural;

  constant RESISTOR_1K_R0603 : pin_map := (P1 => 1, P2 => 2);
  constant RESISTOR_1K_R0805 : pin_map := (P1 => 1, P2 => 2);

  constant RESISTOR_1K_R0603_FP : string := "RESC1608X60N";
  constant RESISTOR_1K_R0805_FP : string := "RESC2012X70N";

  constant RESISTOR_1K_VALUE   : string := "1k";
  constant RESISTOR_1K_MFR     : string := "Generic";
  constant RESISTOR_1K_PARTNUM : string := "RC0603FR-071KL";
end package;

library ieee;
use ieee.std_logic_1164.all;

entity RESISTOR_1K is
  generic (
    PACKAGE_VARIANT : string := "R0603"
  );
  port (
    P1 : inout std_logic;
    P2 : inout std_logic
  );
end entity;

architecture rtl of RESISTOR_1K is
begin
end architecture;