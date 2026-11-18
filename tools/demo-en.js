/**
 * 紹介用の画面（英語版）のデモのデータ。tools/demo.js が `--en` で読む。形は demo.js の SCENARIOS と同じ。
 * README で使う 4 業種（建設・映像制作・デイサービス・放課後スクール）を、英語の名前と業務で組み立てる。名前・住所は、すべて作りもの。
 */
const C = { navy: '#1F2E38', deep: '#2A5C8A', blue: '#2279B6', peri: '#5271C7', violet: '#6965AD', indigo: '#514C94' };

module.exports = [
  {
    slug: 'construction', readme: true, lang: 'en', project: 'Renovation Crew',
    boards: [['Supervisors', C.indigo], ['Crew', C.blue], ['Drivers', C.peri], ['Office', C.deep]],
    admin: ['Robert Hayes', 'Office'],
    mails: ['mark', 'diego', 'ethan', 'sam', 'grace', 'tony', 'carl', 'emily', 'robert'],
    joinName: 'Olivia Reed', joinMail: 'olivia',
    templates: [
      { name: 'Site work', board: 'Crew', minutes: 240, geo: true, fields: [['Progress', 'select', true, ['On schedule', 'Behind', 'Ahead']], ['Done today', 'text'], ['Site photo', 'photo']] },
      { name: 'Material delivery', board: 'Drivers', minutes: 60, geo: true, fields: [['Delivered', 'text', true], ['Received by', 'text'], ['Delivery photo', 'photo']] },
      { name: 'Crew drop-off', board: 'Drivers', minutes: 45, geo: true, fields: [['Passengers', 'number', true]] },
      { name: 'Site check', board: 'Supervisors', minutes: 90, fields: [['Result', 'select', true, ['No issues', 'Needs fixes']], ['Notes', 'long']] }
    ],
    members: [
      ['Mark Reynolds', 'Supervisors', '8:00', '18:00', [
        ['Morning safety briefing', '8:00', '8:30', 'done', { addr: '14 Oak Lane' }],
        ['Site walk-through', '9:30', '11:30', 'done', { tpl: 'Site check', addr: '22 Birch Road', vals: { Result: 'Needs fixes', Notes: 'Loose baseboard in the upstairs bathroom. Fix this afternoon' } }],
        ['Client meeting', '13:00', '14:30', 'active', { addr: '14 Oak Lane', memo: 'Pick the cabinet door color' }],
        ['Final inspection', '15:30', '17:00', 'planned', { tpl: 'Site check', addr: '7 Cedar Court' }]]],
      ['Diego Ramirez', 'Crew', '8:00', '17:00', [
        ['Bathroom waterproofing', '8:30', '12:00', 'done', { tpl: 'Site work', addr: '7 Cedar Court', vals: { Progress: 'On schedule', 'Done today': 'First waterproof layer' } }],
        ['Bathroom tiling', '13:00', '17:00', 'late', { tpl: 'Site work', addr: '7 Cedar Court' }]]],
      ['Ethan Brooks', 'Crew', '8:00', '17:00', [
        ['Kitchen demolition', '8:30', '12:00', 'done', { tpl: 'Site work', addr: '14 Oak Lane', vals: { Progress: 'Ahead', 'Done today': 'Demolition and haul-out' } }],
        ['Kitchen subfloor and framing', '13:00', '17:00', 'active', { tpl: 'Site work', addr: '14 Oak Lane' }]]],
      ['Sam Patel', 'Crew', '8:00', '17:00', [
        ['Floor replacement', '8:30', '12:00', 'done', { tpl: 'Site work', addr: '22 Birch Road', vals: { Progress: 'On schedule' } }],
        ['Baseboard fix', '13:30', '15:00', 'active', { tpl: 'Site work', addr: '22 Birch Road' }],
        ['Pack up tools', '15:30', '16:30', 'planned', { addr: '22 Birch Road' }]]],
      ['Grace Kim', 'Crew', '9:00', '18:00', [
        ['Wallpaper', '9:00', '12:30', 'done', { tpl: 'Site work', addr: '5 Elm Street', vals: { Progress: 'Behind', 'Done today': 'Wall repair took longer. Bedroom tomorrow' } }],
        ['Wallpaper', '13:30', '17:30', 'active', { tpl: 'Site work', addr: '5 Elm Street' }]]],
      ['Tony Chen', 'Drivers', '7:00', '16:00', [
        ['Crew drop-off (Oak & Cedar)', '7:30', '8:20', 'done', { tpl: 'Crew drop-off', addr: '14 Oak Lane', vals: { Passengers: 3 } }],
        ['Material delivery (plywood & drywall)', '10:00', '11:00', 'done', { tpl: 'Material delivery', addr: '5 Elm Street', vals: { Delivered: '20 plywood sheets, 30 drywall panels', 'Received by': 'Grace' } }],
        ['Material delivery (kitchen parts)', '12:15', '13:15', 'done', { tpl: 'Material delivery', addr: '14 Oak Lane', vals: { Delivered: 'Kitchen cabinet set', 'Received by': 'Ethan' } }],
        ['Debris pickup', '14:30', '15:30', 'planned', { addr: '22 Birch Road' }]]],
      ['Carl Jensen', 'Drivers', '7:00', '17:00', [
        ['Crew drop-off (Birch & Elm)', '7:30', '8:40', 'done', { tpl: 'Crew drop-off', addr: '22 Birch Road', vals: { Passengers: 2 } }],
        ['Material delivery (tiles)', '11:30', '12:30', 'done', { tpl: 'Material delivery', addr: '7 Cedar Court', vals: { Delivered: '12 boxes of bathroom tile', 'Received by': 'Diego' } }],
        ['Crew pickup', '16:00', '17:00', 'planned', { tpl: 'Crew drop-off', addr: '7 Cedar Court' }]]],
      ['Emily Carter', 'Office', '9:00', '18:00', [
        ['Estimate for the Willow house', '9:30', '12:00', 'done', {}],
        ['Orders to subcontractors', '13:00', '14:00', 'active', {}],
        ['Invoicing', '15:00', '16:30', 'planned', {}]]]
    ],
    unassigned: [['Emergency leak repair', '14:00', '15:30', { addr: '31 Willow Way', memo: 'Under the bathroom sink. Water is shut off' }], ['Material delivery (wallpaper)', '15:00', '16:00', { tpl: 'Material delivery', addr: '5 Elm Street' }]],
    links: [['Material delivery (kitchen parts)', 'Kitchen subfloor and framing', 'Delivery'], ['Crew drop-off (Oak & Cedar)', 'Kitchen demolition', 'Drop-off'], ['Site walk-through', 'Baseboard fix', 'Fix'], ['Material delivery (tiles)', 'Bathroom tiling', 'Delivery']],
    pick: 'Kitchen subfloor and framing', open: 'Bathroom waterproofing', phone: 'Ethan Brooks',
    report: { Progress: 'On schedule', 'Done today': 'Framing around the sink. Wall cabinets tomorrow' }
  },
  {
    slug: 'creative', readme: true, lang: 'en', project: 'Video Production',
    boards: [['Camera', C.violet], ['Hair, Makeup & Assist', C.blue], ['Drivers', C.peri], ['Producers', C.deep]],
    admin: ['Daniel Park', 'Producers'],
    mails: ['jake', 'leo', 'maya', 'chloe', 'noah', 'marcus', 'sofia', 'hannah', 'daniel'],
    joinName: 'Ryan Fox', joinMail: 'ryan',
    templates: [
      { name: 'Location shoot', board: 'Camera', minutes: 180, geo: true, fields: [['Shots', 'number', true], ['Gear', 'multi', false, ['Camera A', 'Camera B', 'Lighting kit', 'Drone', 'Gimbal']], ['Site photo', 'photo'], ['Notes', 'text']] },
      { name: 'Shoot support', board: 'Hair, Makeup & Assist', minutes: 120, fields: [['Role', 'select', true, ['Hair & makeup', 'Lighting', 'Gear', 'Wardrobe']], ['Notes', 'text']] },
      { name: 'Transport', board: 'Drivers', minutes: 60, geo: true, fields: [['Passengers', 'number', true], ['Cargo', 'text']] }
    ],
    members: [
      ['Jake Morrison', 'Camera', '9:00', '20:00', [
        ['Gear prep', '9:30', '10:30', 'done', {}],
        ['Location shoot (music festival)', '13:00', '17:00', 'late', { tpl: 'Location shoot', addr: 'Harbor Park Stage' }],
        ['Night shoot (city lights)', '18:30', '20:00', 'planned', { tpl: 'Location shoot', addr: 'Riverside Walk' }]]],
      ['Leo Fischer', 'Camera', '8:30', '18:00', [
        ['Location shoot (bakery exterior)', '9:30', '12:00', 'done', { tpl: 'Location shoot', addr: 'Bakery on 3rd Ave', vals: { Shots: 86, Gear: ['Camera A', 'Gimbal'], Notes: 'The sign looks better in afternoon light' } }],
        ['Location shoot (food)', '13:00', '16:00', 'active', { tpl: 'Location shoot', addr: 'Bistro on the River' }]]],
      ['Maya Lopez', 'Camera', '9:00', '19:00', [
        ['Studio shoot (portraits)', '9:30', '11:30', 'done', { addr: 'Main Studio' }],
        ['Location shoot (beach commercial)', '13:00', '17:30', 'active', { tpl: 'Location shoot', addr: 'Sunset Beach' }]]],
      ['Chloe Bennett', 'Hair, Makeup & Assist', '8:30', '18:00', [
        ['Hair & makeup (studio)', '9:00', '11:30', 'done', { tpl: 'Shoot support', addr: 'Main Studio', vals: { Role: 'Hair & makeup' } }],
        ['Hair & makeup (beach commercial)', '13:00', '17:30', 'active', { tpl: 'Shoot support', addr: 'Sunset Beach' }]]],
      ['Noah Wright', 'Hair, Makeup & Assist', '9:00', '18:00', [
        ['Lighting assist (bakery)', '9:30', '12:00', 'done', { tpl: 'Shoot support', addr: 'Bakery on 3rd Ave', vals: { Role: 'Lighting' } }],
        ['Lighting assist (food)', '13:00', '16:00', 'active', { tpl: 'Shoot support', addr: 'Bistro on the River' }],
        ['Gear return', '16:30', '17:30', 'planned', { addr: 'Rental House' }]]],
      ['Marcus Hill', 'Drivers', '8:00', '20:00', [
        ['Crew bus to the beach', '10:30', '12:30', 'done', { tpl: 'Transport', addr: 'Sunset Beach', vals: { Passengers: 6, Cargo: 'Lighting kit, reflectors' } }],
        ['Standby at location', '12:30', '17:30', 'active', { addr: 'Sunset Beach' }],
        ['Crew bus back from the beach', '17:30', '19:30', 'planned', { tpl: 'Transport', addr: 'Sunset Beach' }]]],
      ['Sofia Rossi', 'Drivers', '8:00', '18:00', [
        ['Gear van (bakery)', '8:30', '9:20', 'done', { tpl: 'Transport', addr: 'Bakery on 3rd Ave', vals: { Passengers: 2, Cargo: 'Camera A, gimbal' } }],
        ['Gear van (food)', '11:20', '12:10', 'done', { tpl: 'Transport', addr: 'Bistro on the River', vals: { Passengers: 2, Cargo: 'Lighting kit' } }],
        ['Gear van (music festival)', '12:20', '13:10', 'late', { tpl: 'Transport', addr: 'Harbor Park Stage' }],
        ['Gear return (rental house)', '16:30', '17:30', 'planned', { addr: 'Rental House' }]]],
      ['Hannah Cole', 'Producers', '9:00', '18:00', [
        ['Retouch last week\'s shoot', '10:00', '12:30', 'done', {}],
        ['Client review', '13:00', '14:00', 'active', { meet: true }],
        ['Delivery to the client', '15:00', '16:00', 'planned', {}]]]
    ],
    unassigned: [['Studio shoot (extra request)', '17:30', '19:00', { addr: 'Main Studio' }], ['Location scout drive', '14:30', '15:30', { tpl: 'Transport', addr: 'Riverside Walk' }]],
    links: [['Crew bus to the beach', 'Location shoot (beach commercial)', 'Drop-off'], ['Gear van (food)', 'Location shoot (food)', 'Gear'], ['Hair & makeup (beach commercial)', 'Location shoot (beach commercial)', 'With'], ['Gear van (music festival)', 'Location shoot (music festival)', 'Gear']],
    pick: 'Location shoot (beach commercial)', open: 'Location shoot (bakery exterior)', phone: 'Maya Lopez',
    report: { Shots: 124, Gear: ['Camera A', 'Drone'], Notes: 'Golden hour from 4:40 pm. Drone permit approved' }
  },
  {
    slug: 'daycare', readme: true, lang: 'en', mode: 'dark', project: 'Day Center East',
    boards: [['Drivers', C.peri], ['Care Staff', C.blue], ['Coordinators', C.deep]],
    admin: ['Laura Hughes', 'Coordinators'],
    mails: ['frank', 'linda', 'george', 'kevin', 'rachel', 'megan', 'susan', 'patricia', 'laura'],
    joinName: 'Amy Ross', joinMail: 'amy',
    templates: [
      { name: 'Shuttle', board: 'Drivers', minutes: 75, geo: true, fields: [['Riders', 'number', true], ['Vehicle', 'select', true, ['Van 1', 'Van 2', 'Van 3']], ['Vehicle photo', 'photo'], ['Notes', 'text']] },
      { name: 'Ride-along', board: 'Care Staff', minutes: 75, fields: [['Assistance', 'multi', false, ['Boarding', 'Wheelchair', 'Supervision']], ['Notes', 'text']] },
      { name: 'Activity', board: 'Care Staff', minutes: 60, fields: [['Attendees', 'number', true], ['Type', 'select', true, ['Exercise', 'Rehab', 'Recreation', 'Bathing']], ['Notes', 'text']] },
      { name: 'Home visit', board: 'Coordinators', minutes: 60, geo: true, fields: [['Purpose', 'select', true, ['Intake visit', 'Contract', 'Family meeting']], ['Notes', 'long']] }
    ],
    members: [
      ['Frank Miller', 'Drivers', '7:30', '17:30', [
        ['Morning pickup – Route A', '8:00', '9:15', 'done', { tpl: 'Shuttle', addr: 'Northside area', vals: { Riders: 6, Vehicle: 'Van 1' } }],
        ['Vehicle check and cleaning', '10:00', '11:00', 'done', {}],
        ['Midday pickup (afternoon guests)', '13:00', '13:50', 'active', { tpl: 'Shuttle', addr: 'Lakeview area' }],
        ['Evening drop-off – Route A', '15:45', '17:00', 'planned', { tpl: 'Shuttle', addr: 'Northside area' }]]],
      ['Linda Price', 'Drivers', '7:30', '17:30', [
        ['Morning pickup – Route B', '8:00', '9:20', 'done', { tpl: 'Shuttle', addr: 'Westfield area', vals: { Riders: 6, Vehicle: 'Van 2' } }],
        ['Midday drop-off (morning guests)', '12:00', '12:45', 'done', { tpl: 'Shuttle', addr: 'Westfield area', vals: { Riders: 2, Vehicle: 'Van 2' } }],
        ['Evening drop-off – Route B', '15:45', '17:00', 'planned', { tpl: 'Shuttle', addr: 'Westfield area' }]]],
      ['George Allen', 'Drivers', '7:30', '17:30', [
        ['Morning pickup – Route C', '8:10', '9:30', 'done', { tpl: 'Shuttle', addr: 'Hillcrest area', vals: { Riders: 5, Vehicle: 'Van 3' } }],
        ['Midday pickup – Route C', '12:50', '13:40', 'late', { tpl: 'Shuttle', addr: 'Hillcrest area' }],
        ['Evening drop-off – Route C', '15:45', '17:10', 'planned', { tpl: 'Shuttle', addr: 'Hillcrest area' }]]],
      ['Kevin Nguyen', 'Care Staff', '8:00', '17:00', [
        ['Morning ride-along – Route A', '8:00', '9:15', 'done', { tpl: 'Ride-along', addr: 'Northside area', vals: { Assistance: ['Boarding', 'Wheelchair'] } }],
        ['Exercise', '10:00', '10:45', 'done', { tpl: 'Activity', vals: { Attendees: 18, Type: 'Exercise' } }],
        ['Rehab exercises', '13:00', '14:00', 'active', { tpl: 'Activity' }],
        ['Evening ride-along – Route A', '15:45', '17:00', 'planned', { tpl: 'Ride-along', addr: 'Northside area' }]]],
      ['Rachel Adams', 'Care Staff', '8:30', '17:30', [
        ['Bathing', '9:30', '11:30', 'done', { tpl: 'Activity', vals: { Attendees: 6, Type: 'Bathing' } }],
        ['Recreation', '13:00', '14:30', 'active', { tpl: 'Activity' }],
        ['Evening ride-along – Route B', '15:45', '17:00', 'planned', { tpl: 'Ride-along', addr: 'Westfield area' }]]],
      ['Megan Clark', 'Care Staff', '8:30', '17:30', [
        ['Rehab exercises', '10:00', '11:00', 'done', { tpl: 'Activity', vals: { Attendees: 8, Type: 'Rehab' } }],
        ['Midday ride-along (afternoon guests)', '13:00', '13:50', 'active', { tpl: 'Ride-along', addr: 'Lakeview area' }],
        ['Snack time and supervision', '14:30', '15:30', 'planned', {}]]],
      ['Susan Turner', 'Coordinators', '9:00', '18:00', [
        ['Intake visit', '10:00', '11:00', 'done', { tpl: 'Home visit', addr: 'Maple Heights', vals: { Purpose: 'Intake visit', Notes: 'Needs wheelchair transport. Prefers Tuesdays and Fridays' } }],
        ['Care manager meeting', '13:30', '14:30', 'planned', { meet: true }],
        ['Family meeting', '15:30', '16:30', 'planned', { tpl: 'Home visit', addr: 'Elm Park' }]]],
      ['Patricia Moore', 'Coordinators', '9:00', '18:00', [
        ['Today\'s attendance check', '9:00', '10:00', 'done', {}],
        ['Rework tomorrow\'s routes', '13:00', '14:30', 'active', {}],
        ['Billing prep', '15:00', '16:30', 'planned', {}]]]
    ],
    unassigned: [['Evening drop-off (1 extra rider)', '16:00', '16:40', { tpl: 'Shuttle', addr: 'Lakeview area', memo: 'Wheelchair. Same-day request from the family' }], ['Trial guest drop-off', '15:30', '16:10', { tpl: 'Shuttle', addr: 'Maple Heights' }]],
    links: [['Morning pickup – Route A', 'Morning ride-along – Route A', 'Ride-along'], ['Midday pickup (afternoon guests)', 'Midday ride-along (afternoon guests)', 'Ride-along'], ['Evening drop-off – Route A', 'Evening ride-along – Route A', 'Ride-along'], ['Evening drop-off – Route B', 'Evening ride-along – Route B', 'Ride-along']],
    pick: 'Midday pickup (afternoon guests)', open: 'Morning pickup – Route A', phone: 'Frank Miller',
    report: { Riders: 3, Vehicle: 'Van 1', Notes: 'One rider needs the handrail at the door' }
  },
  {
    slug: 'education', readme: true, lang: 'en', mode: 'dark', project: 'After-School Program East',
    boards: [['Drivers', C.peri], ['Instructors', C.blue], ['Office', C.deep]],
    admin: ['Michelle Baker', 'Office'],
    mails: ['bill', 'nina', 'paul', 'alex', 'jessica', 'olivia', 'tyler', 'karen', 'michelle'],
    joinName: 'Ryan Fox', joinMail: 'ryan',
    templates: [
      { name: 'Pickup / drop-off', board: 'Drivers', minutes: 50, geo: true, fields: [['Riders', 'number', true], ['Vehicle', 'select', true, ['Van 1', 'Van 2', 'Van 3']], ['Notes', 'text']] },
      { name: 'Class', board: 'Instructors', minutes: 60, fields: [['Attendance', 'number', true], ['Topic', 'text'], ['Notes', 'long']] },
      { name: 'Workshop', board: 'Instructors', minutes: 90, geo: true, fields: [['Participants', 'number', true], ['Subject', 'select', true, ['Coding', 'English', 'Science']], ['Class photo', 'photo'], ['Notes', 'text']] }
    ],
    members: [
      ['Bill Harper', 'Drivers', '8:00', '19:00', [
        ['Vehicle check', '11:00', '11:45', 'done', {}],
        ['Grade 1 pickup (Southside Elem.)', '13:00', '13:50', 'active', { tpl: 'Pickup / drop-off', addr: 'Southside Elementary' }],
        ['Grades 2–3 pickup (Southside Elem.)', '14:40', '15:30', 'planned', { tpl: 'Pickup / drop-off', addr: 'Southside Elementary' }],
        ['Drop-off – East route', '18:00', '19:00', 'planned', { tpl: 'Pickup / drop-off', addr: 'East district' }]]],
      ['Nina Torres', 'Drivers', '8:00', '19:00', [
        ['Workshop drop-off (instructor and gear)', '9:00', '9:40', 'done', { tpl: 'Pickup / drop-off', addr: 'Lincoln Elementary', vals: { Riders: 2, Vehicle: 'Van 2', Notes: '30 laptops' } }],
        ['Workshop pickup', '11:40', '12:20', 'done', { tpl: 'Pickup / drop-off', addr: 'Lincoln Elementary', vals: { Riders: 2, Vehicle: 'Van 2' } }],
        ['Pickup (Northside Elem.)', '14:50', '15:40', 'planned', { tpl: 'Pickup / drop-off', addr: 'Northside Elementary' }],
        ['Drop-off – North route', '18:00', '19:00', 'planned', { tpl: 'Pickup / drop-off', addr: 'North district' }]]],
      ['Paul Evans', 'Drivers', '12:00', '19:00', [
        ['Pickup (Eastside Elem.)', '13:00', '13:45', 'late', { tpl: 'Pickup / drop-off', addr: 'Eastside Elementary' }],
        ['Drive to swim class', '16:30', '17:00', 'planned', { tpl: 'Pickup / drop-off', addr: 'Community Pool' }],
        ['Drop-off – South route', '18:10', '19:00', 'planned', { tpl: 'Pickup / drop-off', addr: 'South district' }]]],
      ['Alex Morgan', 'Instructors', '9:00', '18:00', [
        ['Coding workshop (Lincoln Elem.)', '9:50', '11:30', 'done', { tpl: 'Workshop', addr: 'Lincoln Elementary', vals: { Participants: 28, Subject: 'Coding', Notes: 'Class 2 next time. Use the school projector' } }],
        ['Grade 1 class (homework)', '14:00', '15:00', 'planned', { tpl: 'Class' }],
        ['English class', '16:00', '17:00', 'planned', { tpl: 'Class' }]]],
      ['Jessica Lee', 'Instructors', '9:00', '18:00', [
        ['English workshop (Oakwood Elem.)', '10:30', '12:00', 'done', { tpl: 'Workshop', addr: 'Oakwood Elementary', vals: { Participants: 31, Subject: 'English' } }],
        ['Prep materials', '13:00', '14:00', 'active', {}],
        ['Science lab class', '16:00', '17:30', 'planned', { tpl: 'Class' }]]],
      ['Olivia Scott', 'Instructors', '11:00', '19:00', [
        ['Grade 1 arrival', '13:30', '14:00', 'planned', {}],
        ['Snack and supervision', '15:00', '16:00', 'planned', {}],
        ['Dismissal', '17:45', '18:15', 'planned', {}]]],
      ['Tyler Young', 'Instructors', '13:00', '19:00', [
        ['Homework help', '15:30', '17:00', 'planned', { tpl: 'Class' }],
        ['Drop-off ride-along', '18:00', '19:00', 'planned', { addr: 'East district' }]]],
      ['Karen White', 'Office', '9:00', '18:00', [
        ['Check messages from parents', '9:00', '10:00', 'done', {}],
        ['Trial sign-up inquiries', '10:30', '12:00', 'done', {}],
        ['Update the pickup schedule', '13:00', '14:00', 'active', {}],
        ['Trial family meeting', '16:30', '17:30', 'planned', { meet: true }]]]
    ],
    unassigned: [['Pickup (Eastside Elem., 2 extra kids)', '15:00', '15:50', { tpl: 'Pickup / drop-off', addr: 'Eastside Elementary', memo: 'Same-day request from parents' }], ['Scout the next workshop site', '16:00', '17:00', { addr: 'Greenfield Elementary' }]],
    links: [['Workshop drop-off (instructor and gear)', 'Coding workshop (Lincoln Elem.)', 'Drop-off'], ['Grade 1 pickup (Southside Elem.)', 'Grade 1 arrival', 'Arrival'], ['Drop-off – East route', 'Drop-off ride-along', 'Ride-along']],
    pick: 'Grade 1 pickup (Southside Elem.)', open: 'Coding workshop (Lincoln Elem.)', phone: 'Bill Harper', siteOn: 'open',
    report: { Riders: 8, Vehicle: 'Van 1', Notes: 'One child absent (parent let us know)' }
  }
];
