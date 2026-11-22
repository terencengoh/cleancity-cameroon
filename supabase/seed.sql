-- Seed: the 10 regions, 15 cities with quarters, starter zones (meeting points are approximate: confirm on the ground
-- with each commune), and the default settings confirmed by the owner: 50,000 FCFA/week, 5,000 FCFA/person, 1 zone/week → 10 people.

insert into public.regions (id, name_en, name_fr) values
  ('adamawa', 'Adamawa', 'Adamaoua'),
  ('centre', 'Centre', 'Centre'),
  ('east', 'East', 'Est'),
  ('far_north', 'Far North', 'Extrême-Nord'),
  ('littoral', 'Littoral', 'Littoral'),
  ('north', 'North', 'Nord'),
  ('northwest', 'Northwest', 'Nord-Ouest'),
  ('west', 'West', 'Ouest'),
  ('south', 'South', 'Sud'),
  ('southwest', 'Southwest', 'Sud-Ouest')
on conflict (id) do nothing;

insert into public.cities (id, region_id, name, lat, lng, quarters) values
  ('ngaoundere', 'adamawa', 'Ngaoundéré', 7.327, 13.584, array['Bamyanga', 'Joli Soir', 'Dang', 'Sabongari', 'Centre commercial']::text[]),
  ('yaounde', 'centre', 'Yaoundé', 3.848, 11.5021, array['Bastos', 'Mvog-Mbi', 'Mokolo', 'Essos', 'Biyem-Assi', 'Melen', 'Nlongkak', 'Ekounou']::text[]),
  ('bertoua', 'east', 'Bertoua', 4.577, 13.685, array['Tigaza', 'Nkolbikon', 'Mokolo', 'Centre-ville']::text[]),
  ('maroua', 'far_north', 'Maroua', 10.591, 14.316, array['Domayo', 'Dougoï', 'Kakataré', 'Centre-ville']::text[]),
  ('douala', 'littoral', 'Douala', 4.0511, 9.7679, array['Akwa', 'Bonanjo', 'Bonapriso', 'Deïdo', 'Bonabéri', 'Makepe', 'Ndokoti', 'Bépanda']::text[]),
  ('nkongsamba', 'littoral', 'Nkongsamba', 4.9547, 9.9404, array['Centre-ville', 'Quartier administratif', 'Autre quartier']::text[]),
  ('garoua', 'north', 'Garoua', 9.301, 13.397, array['Roumdé Adjia', 'Yelwa', 'Poumpoumré', 'Centre-ville']::text[]),
  ('bamenda', 'northwest', 'Bamenda', 5.9631, 10.1591, array['Commercial Avenue', 'Nkwen', 'Mankon', 'Up Station']::text[]),
  ('bafoussam', 'west', 'Bafoussam', 5.4778, 10.4176, array['Tamdja', 'Djeleng', 'Banengo', 'Centre-ville']::text[]),
  ('dschang', 'west', 'Dschang', 5.45, 10.053, array['Foto', 'Foréké', 'Centre-ville', 'Autre quartier']::text[]),
  ('ebolowa', 'south', 'Ebolowa', 2.915, 11.154, array['Nko''ovos', 'Angalé', 'Centre-ville', 'Autre quartier']::text[]),
  ('kribi', 'south', 'Kribi', 2.9395, 9.91, array['Mpangou', 'Ngoyè', 'Centre-ville', 'Autre quartier']::text[]),
  ('buea', 'southwest', 'Buea', 4.1527, 9.241, array['Molyko', 'Great Soppo', 'Bonduma', 'Buea Town']::text[]),
  ('limbe', 'southwest', 'Limbe', 4.0186, 9.2043, array['Down Beach', 'Mile 4', 'Bota', 'Church Street']::text[]),
  ('kumba', 'southwest', 'Kumba', 4.6363, 9.4469, array['Fiango', 'Kumba Town', 'Mbonge Road', 'Other quarter']::text[])
on conflict (id) do nothing;

insert into public.zones (id, city_id, name, quarters, meet, lat, lng, rotation) values
  ('dla-akwa', 'douala', 'Akwa – Bonanjo', array['Akwa', 'Bonanjo']::text[], 'Akwa', 4.046, 9.693, 1),
  ('yde-bastos', 'yaounde', 'Bastos – Nlongkak', array['Bastos', 'Nlongkak']::text[], 'Bastos', 3.889, 11.51, 2),
  ('buea-molyko', 'buea', 'Molyko – Bonduma', array['Molyko', 'Bonduma']::text[], 'Molyko', 4.152, 9.287, 3),
  ('bda-commercial', 'bamenda', 'Commercial Avenue – Nkwen', array['Commercial Avenue', 'Nkwen']::text[], 'Commercial Avenue', 5.963, 10.159, 4),
  ('bfs-tamdja', 'bafoussam', 'Tamdja – Centre', array['Tamdja', 'Centre-ville']::text[], 'Tamdja', 5.478, 10.418, 5),
  ('dla-bonapriso', 'douala', 'Bonapriso – Deïdo', array['Bonapriso', 'Deïdo']::text[], 'Bonapriso', 4.035, 9.697, 6),
  ('yde-mvogmbi', 'yaounde', 'Mvog-Mbi – Ekounou', array['Mvog-Mbi', 'Ekounou']::text[], 'Mvog-Mbi', 3.856, 11.518, 7),
  ('gar-centre', 'garoua', 'Roumdé Adjia – Centre', array['Roumdé Adjia', 'Centre-ville']::text[], 'Roumdé Adjia', 9.301, 13.397, 8),
  ('mar-domayo', 'maroua', 'Domayo – Centre', array['Domayo', 'Centre-ville']::text[], 'Domayo', 10.591, 14.316, 9),
  ('ngd-centre', 'ngaoundere', 'Centre commercial – Joli Soir', array['Centre commercial', 'Joli Soir']::text[], 'Centre commercial', 7.327, 13.584, 10),
  ('ber-centre', 'bertoua', 'Centre – Tigaza', array['Centre-ville', 'Tigaza']::text[], 'Centre-ville', 4.577, 13.685, 11),
  ('ebw-centre', 'ebolowa', 'Centre – Angalé', array['Centre-ville', 'Angalé']::text[], 'Centre-ville', 2.915, 11.154, 12),
  ('lmb-downbeach', 'limbe', 'Down Beach – Church Street', array['Down Beach', 'Church Street']::text[], 'Down Beach', 4.009, 9.207, 13),
  ('kri-centre', 'kribi', 'Centre – Mpangou', array['Centre-ville', 'Mpangou']::text[], 'Centre-ville', 2.9395, 9.91, 14),
  ('kum-town', 'kumba', 'Kumba Town – Fiango', array['Kumba Town', 'Fiango']::text[], 'Kumba Town', 4.636, 9.447, 15),
  ('dsc-centre', 'dschang', 'Centre – Foto', array['Centre-ville', 'Foto']::text[], 'Centre-ville', 5.45, 10.053, 16),
  ('nks-centre', 'nkongsamba', 'Centre-ville', array['Centre-ville', 'Quartier administratif']::text[], 'Centre-ville', 4.9547, 9.9404, 17),
  ('dla-makepe', 'douala', 'Makepe – Ndokoti', array['Makepe', 'Ndokoti']::text[], 'Makepe', 4.068, 9.752, 18),
  ('yde-biyemassi', 'yaounde', 'Biyem-Assi – Melen', array['Biyem-Assi', 'Melen']::text[], 'Biyem-Assi', 3.84, 11.488, 19)
on conflict (id) do nothing;

insert into public.settings (id, weekly_budget_xaf, pay_per_person_xaf, zones_per_week) values (true, 50000, 5000, 1) on conflict (id) do nothing;
