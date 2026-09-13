-- top.vhd — top-level design.
library ieee;
use ieee.std_logic_1164.all;

entity top is
  port (
    CLK : in  std_logic;
    RST : in  std_logic
  );
end entity;

architecture rtl of top is
begin
  -- U1 : entity work.MY_PART
  --   generic map (PACKAGE_VARIANT => "SOIC8")
  --   port map ( ... );
end architecture;
