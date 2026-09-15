-- EHDL component: NE555
-- ne555.prt.ehd — NE555 precision timer (DIP-8 / SOIC-8).
library ieee;
use ieee.std_logic_1164.all;

package ne555_pkg is
  type ne555_pin is (GND, TRIG, OUT, RESET, CTRL, THRESH, DISCH, VCC);
  type pin_map is array (ne555_pin) of natural;

  constant NE555_DIP8 : pin_map := (GND => 1, TRIG => 2, OUT => 3, RESET => 4, CTRL => 5, THRESH => 6, DISCH => 7, VCC => 8);
  constant NE555_DIP8_FP : string := "DIP762W60P254L940H508Q8N";

  constant NE555_SOIC8 : pin_map := (GND => 1, TRIG => 2, OUT => 3, RESET => 4, CTRL => 5, THRESH => 6, DISCH => 7, VCC => 8);
  constant NE555_SOIC8_FP : string := "SOIC127P600X175-8N";

  constant NE555_MFR : string := "Texas Instruments";
  constant NE555_PARTNUM : string := "NE555P";
  constant NE555_DESC : string := "Precision timer, astable or monostable";
  constant NE555_SYMBOL : string := "..\symbols\ne555.ts";
end package;

library ieee;
use ieee.std_logic_1164.all;

entity NE555 is
  generic (
    PACKAGE_VARIANT : string := "DIP8"
  );
  port (
    GND : in std_logic;
    TRIG : in std_logic;
    OUT : out std_logic;
    RESET : in std_logic;
    CTRL : in std_logic;
    THRESH : in std_logic;
    DISCH : out std_logic;
    VCC : in std_logic
  );
end entity;

architecture rtl of NE555 is
begin
end architecture;
