-- Applied live 2026-11-20. Body mapping for the Beyonder pathways the Sefirot spec did not name (operator's skills only).
-- The 13 named in the spec were tagged first; these 19 are by thematic analogy and can be changed freely.
SET lock_timeout = '3s';
UPDATE public.skills s SET body_mapping = m.tag
FROM (VALUES
 ('Tyrant','kinetic_limb'),('Circle_of_Inevitability','kinetic_limb'),('Primordial_Hunger','kinetic_limb'),('Chained','kinetic_limb'),
 ('Eternal Edict','skeletal_law'),('Second Law','skeletal_law'),('Paragon','skeletal_law'),('Death','skeletal_law'),
 ('Hermit','ocular_sense'),('Star_Pathway','ocular_sense'),('Sun','ocular_sense'),('Hanged_Man','ocular_sense'),
 ('Mother','primal_magnetism'),('Valley God','primal_magnetism'),('Moon','primal_magnetism'),
 ('Wheel_of_Fortune','quantum_drift'),('The_Abyss','quantum_drift'),('Chaos Mist','quantum_drift'),('Darkness','quantum_drift')
) AS m(name, tag)
WHERE s.category = 'Beyonder' AND s.parent_skill_id IS NULL AND s.body_mapping IS NULL AND s.is_sovereign_trunk = false AND s.name = m.name
  AND s.user_id = (SELECT user_id FROM public.skills WHERE id = '69d09445-8e38-4ff8-8a14-791fd3732683');
